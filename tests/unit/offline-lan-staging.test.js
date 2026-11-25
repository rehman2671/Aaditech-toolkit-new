import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,chmod,writeFile,readdir,readFile,rm,lstat,realpath,symlink,link,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectStagedLanBundle as inspect} from '../../scripts/inspect-staged-lan-bundle.mjs';
import {runStagedInspectionCli} from '../../scripts/inspect-staged-lan-bundle-cli.mjs';
import {runOfflineStagingCli} from '../../scripts/stage-offline-lan-bundle-cli.mjs';
import {stageOfflineLanBundle as stage} from '../../scripts/stage-offline-lan-bundle.mjs';
import {verifySignedLanBundle} from '../../scripts/verify-lan-bundle.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(fn){
 const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-offline-stage-'));
 try{
  const root=join(dir,'source'),destinationParent=join(dir,'destination');
  await mkdir(root);await mkdir(destinationParent,{mode:0o700});await chmod(destinationParent,0o700);
  await mkdir(join(root,'images'));
  const contents={'images/app.tar':Buffer.from('synthetic app archive'),'images/db.tar':Buffer.from('synthetic db archive'),'empty':Buffer.alloc(0)};
  for(const [name,b] of Object.entries(contents))await writeFile(join(root,name),b);
  const doc={schema_version:1,installation_mode:'intranet',files:Object.entries(contents).map(([path,b])=>({path,size:b.length,sha256:sha(b)}))};
  const keys=generateKeyPairSync('ed25519'),manifest=join(dir,'manifest.json'),signature=join(dir,'manifest.sig');
  const bytes=Buffer.from(JSON.stringify(doc));
  await writeFile(manifest,bytes);await writeFile(signature,sign(null,bytes,keys.privateKey));
  const bundle={root,manifest,signature,trustedManifestSha256:sha(bytes),
   trustedPublicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),trustedSignerSpkiSha256:sha(keys.publicKey.export({type:'spki',format:'der'}))};
  await fn({dir,bundle,destinationParent,contents,input:{confirmation:'STAGE_VERIFIED_OFFLINE_BUNDLE_ONLY',bundle,destinationParent}});
 }finally{await rm(dir,{recursive:true,force:true})}
}
describe.skipIf(process.platform!=='linux')('verified offline private staging',()=>{
 it('copies actual pinned signed payload into exclusive private durable staging and independently re-verifies',()=>fixture(async({input,bundle,contents})=>{
  const r=await stage(input),root=join(r.staged_directory,'payload');
  expect(r).toMatchObject({files:3,staged_signature_verified:true,staged_payload_integrity_verified:true,runtime_imported:false,installation_authorized:false,production_accepted:false});
  for(const [name,bytes] of Object.entries(contents)){
   const path=join(root,name);expect(await readFile(path)).toEqual(bytes);expect((await lstat(path)).mode&0o777).toBe(0o600);
  }
  expect((await lstat(r.staged_directory)).mode&0o777).toBe(0o700);
  expect((await verifySignedLanBundle({...bundle,root,manifest:join(r.staged_directory,'manifest.json'),signature:join(r.staged_directory,'manifest.sig')})).verified).toBe(true);
 }));
 it('independent simultaneous staging never overwrites an earlier copy',()=>fixture(async({input,destinationParent})=>{
  const a=await Promise.all([stage(input),stage(input)]);
  expect(new Set(a.map(x=>x.staged_directory)).size).toBe(2);expect(await readdir(destinationParent)).toHaveLength(2);
 }));
 for(const [name,mutate] of [
  ['wrong confirmation',async x=>({...x.input,confirmation:'wrong'})],
  ['relative destination',async x=>({...x.input,destinationParent:'relative'})],
  ['wrong signer',async x=>({...x.input,bundle:{...x.bundle,trustedSignerSpkiSha256:'a'.repeat(64)}})],
  ['wrong manifest',async x=>({...x.input,bundle:{...x.bundle,trustedManifestSha256:'b'.repeat(64)}})],
  ['changed payload',async x=>{await writeFile(join(x.bundle.root,'images/app.tar'),'bad');return x.input}],
  ['extra payload',async x=>{await writeFile(join(x.bundle.root,'extra'),'bad');return x.input}],
  ['unsafe destination mode',async x=>{await chmod(x.destinationParent,0o755);return x.input}],
  ['source destination overlap',async x=>{await chmod(x.bundle.root,0o700);return {...x.input,destinationParent:x.bundle.root}}],
  ['linked payload',async x=>{await link(join(x.bundle.root,'empty'),join(x.dir,'alias'));return x.input}],
  ['symlink destination',async x=>{const alias=join(x.dir,'alias');await symlink(x.destinationParent,alias);return {...x.input,destinationParent:alias}}]
 ])it('refuses '+name+' before publishing a usable stage',()=>fixture(async x=>{
  await expect(stage(await mutate(x))).rejects.toThrow();expect(await readdir(x.destinationParent)).toEqual([]);
 }));
});

describe.skipIf(process.platform!=='linux')('offline staging operator CLI',()=>{
 const args=['--confirm-local-staging'];
 it('materializes a real signed fixture through bounded stdin and returns verified location',()=>fixture(async x=>{
  const script=fileURLToPath(new URL('../../scripts/stage-offline-lan-bundle-cli.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,...args],{input:JSON.stringify({bundle:x.bundle,destinationParent:x.destinationParent}),encoding:'utf8',timeout:15000});
  expect(result.status).toBe(0);expect(result.stderr).toBe('');
  const r=JSON.parse(result.stdout);
  expect(r).toMatchObject({staged_signature_verified:true,installation_authorized:false});
  expect(await readdir(x.destinationParent)).toHaveLength(1);
  expect(result.stdout).not.toContain(x.bundle.trustedPublicKeyPem);
 }));
 it('refuses unexpected options, oversize data and malformed UTF-8 before writes',()=>fixture(async x=>{
  const bytes=Buffer.from(JSON.stringify({bundle:x.bundle,destinationParent:x.destinationParent}));
  for(const [payload,flags] of [[bytes,[]],[bytes,[...args,'--force']],[Buffer.alloc(32769),args],[Buffer.from([0xff]),args],[Buffer.alloc(0),args]])
   await expect(runOfflineStagingCli(payload,flags)).rejects.toThrow('OFFLINE_STAGING_INPUT_INVALID');
  expect(await readdir(x.destinationParent)).toEqual([]);
 }));
 it('rejects duplicate decoded keys, unknown fields and nonabsolute paths',()=>fixture(async x=>{
  const doc={bundle:x.bundle,destinationParent:x.destinationParent},raw=JSON.stringify(doc);
  const invalid=[raw.replace('"bundle":','"bundle":{},"bundle":'),raw.replace('"bundle":','"bu\\u006edle":{},"bundle":'),
   JSON.stringify({...doc,execute:true}),JSON.stringify({...doc,bundle:{...doc.bundle,token:'secret'}}),
   JSON.stringify({...doc,bundle:{...doc.bundle,root:'relative'}})];
  for(const payload of invalid)await expect(runOfflineStagingCli(Buffer.from(payload),args)).rejects.toThrow('OFFLINE_STAGING_INPUT_INVALID');
  expect(await readdir(x.destinationParent)).toEqual([]);
 }));
});

describe.skipIf(process.platform!=='linux')('staged release custody and independent re-verification',()=>{
 async function staged(x){
  const r=await stage(x.input);
  return {confirmation:'INSPECT_STAGED_RELEASE_ONLY',stagedDirectory:r.staged_directory,
    trustedManifestSha256:x.bundle.trustedManifestSha256,trustedSignerSpkiSha256:x.bundle.trustedSignerSpkiSha256,
    trustedPublicKeyPem:x.bundle.trustedPublicKeyPem};
 }
 it('reverifies a staged copy independently after source removal',()=>fixture(async x=>{
  const q=await staged(x);await rm(x.bundle.root,{recursive:true});
  const r=await inspect(q);expect(r).toMatchObject({files:3,private_custody_observed:true,staged_signature_verified:true,
    staged_payload_integrity_verified:true,runtime_imported:false,installation_authorized:false,production_accepted:false});
  expect(JSON.stringify(r)).not.toContain(q.stagedDirectory);
 }));
 for(const [name,change] of [
  ['no confirmation',async(q)=>({...q,confirmation:undefined})],
  ['wrong manifest pin',async(q)=>({...q,trustedManifestSha256:'a'.repeat(64)})],
  ['wrong signer pin',async(q)=>({...q,trustedSignerSpkiSha256:'b'.repeat(64)})],
  ['zero manifest pin',async(q)=>({...q,trustedManifestSha256:'0'.repeat(64)})],
  ['zero signer pin',async(q)=>({...q,trustedSignerSpkiSha256:'0'.repeat(64)})],
  ['uppercase manifest pin',async(q)=>({...q,trustedManifestSha256:q.trustedManifestSha256.toUpperCase()})],
  ['noncanonical directory',async(q)=>({...q,stagedDirectory:q.stagedDirectory+'/.'})],
  ['relative directory',async(q)=>({...q,stagedDirectory:'release-123456'})],
  ['stage name newline',async(q)=>({...q,stagedDirectory:q.stagedDirectory+'\n'})],
  ['private parent mode changed',async(q,x)=>{await chmod(x.destinationParent,0o755);return q}],
  ['stage mode changed',async(q)=>{await chmod(q.stagedDirectory,0o755);return q}],
  ['payload mode changed',async(q)=>{await chmod(join(q.stagedDirectory,'payload'),0o755);return q}],
  ['nested directory mode changed',async(q)=>{await chmod(join(q.stagedDirectory,'payload/images'),0o755);return q}],
  ['manifest mode changed',async(q)=>{await chmod(join(q.stagedDirectory,'manifest.json'),0o644);return q}],
  ['signature mode changed',async(q)=>{await chmod(join(q.stagedDirectory,'manifest.sig'),0o644);return q}],
  ['payload mode changed',async(q)=>{await chmod(join(q.stagedDirectory,'payload/images/app.tar'),0o644);return q}],
  ['payload content changed',async(q)=>{await writeFile(join(q.stagedDirectory,'payload/images/app.tar'),'changed');return q}],
  ['extra top-level file',async(q)=>{await writeFile(join(q.stagedDirectory,'extra'),'x',{mode:0o600});return q}],
  ['extra payload file',async(q)=>{await writeFile(join(q.stagedDirectory,'payload/extra'),'x',{mode:0o600});return q}],
  ['missing payload',async(q)=>{await rm(join(q.stagedDirectory,'payload/empty'));return q}],
  ['hardlinked payload',async(q,x)=>{await link(join(q.stagedDirectory,'payload/empty'),join(x.dir,'alias'));return q}],
  ['symlinked payload',async(q,x)=>{await rm(join(q.stagedDirectory,'payload/empty'));await symlink(join(x.bundle.root,'empty'),join(q.stagedDirectory,'payload/empty'));return q}],
  ['substituted detached signature',async(q)=>{await writeFile(join(q.stagedDirectory,'manifest.sig'),Buffer.alloc(64));return q}],
  ['substituted manifest',async(q)=>{await writeFile(join(q.stagedDirectory,'manifest.json'),'{}');return q}],
  ['renamed stage',async(q,x)=>{const dest=join(x.destinationParent,'renamed');await rename(q.stagedDirectory,dest);return {...q,stagedDirectory:dest}}]
 ])it('refuses '+name,()=>fixture(async x=>{const q=await staged(x);await expect(inspect(await change(q,x))).rejects.toThrow()}));
 it('exposes bounded read-only operator inspection and refuses duplicate keys',()=>fixture(async x=>{
  const {confirmation,...q}=await staged(x),raw=JSON.stringify(q),flags=['--confirm-local-read-only'];
  const script=fileURLToPath(new URL('../../scripts/inspect-staged-lan-bundle-cli.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,...flags],{input:raw,encoding:'utf8',timeout:15000});
  expect(result.status).toBe(0);expect(JSON.parse(result.stdout).private_custody_observed).toBe(true);
  expect(result.stdout).not.toContain(q.stagedDirectory);
  for(const [bytes,args] of [[Buffer.from(raw),[]],[Buffer.alloc(32769),flags],[Buffer.from([255]),flags],
   [Buffer.from(raw.replace('"stagedDirectory":','"stagedDirectory":null,"stagedDirectory":')),flags],
   [Buffer.from(JSON.stringify({...q,execute:true})),flags]])
   await expect(runStagedInspectionCli(bytes,args)).rejects.toThrow('STAGED_RELEASE_INPUT_INVALID');
 }));
});

describe.skipIf(process.platform!=='linux')('offline staging early capacity fences',()=>{
 it('refuses oversized declared payload before reading payload or creating stage',()=>fixture(async x=>{
  const doc=JSON.parse(await readFile(x.bundle.manifest,'utf8'));
  doc.files[0].size=65*1024*1024*1024;
  const bytes=Buffer.from(JSON.stringify(doc));await writeFile(x.bundle.manifest,bytes);
  await rm(x.bundle.root+'/images/app.tar');
  const bundle={...x.bundle,trustedManifestSha256:sha(bytes)};
  await expect(stage({...x.input,bundle})).rejects.toThrow('STAGING_CAPACITY_UNVERIFIED');
  expect(await readdir(x.destinationParent)).toEqual([]);
 }));
 it('rejects invalid declared size before reading payload or creating stage',()=>fixture(async x=>{
  const doc=JSON.parse(await readFile(x.bundle.manifest,'utf8'));doc.files[0].size='5';
  const bytes=Buffer.from(JSON.stringify(doc));await writeFile(x.bundle.manifest,bytes);
  await expect(stage({...x.input,bundle:{...x.bundle,trustedManifestSha256:sha(bytes)}})).rejects.toThrow('STAGING_METADATA_INVALID');
  expect(await readdir(x.destinationParent)).toEqual([]);
 }));
});
