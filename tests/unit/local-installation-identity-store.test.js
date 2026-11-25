import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,chmod,writeFile,readFile,rm,lstat,realpath,readdir,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {initializeLocalInstallationIdentity as initialize,inspectLocalInstallationIdentity as inspect} from '../../scripts/local-installation-identity-store.mjs';
import {withLocalSetupLock} from '../../scripts/local-setup-lock.mjs';
import {runLocalIdentityCli} from '../../scripts/local-installation-identity-cli.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const name='installation-identity.json';
const start='INITIALIZE_EMPTY_IDENTITY_STORE_ONLY',review='INSPECT_PINNED_IDENTITY_STORE_ONLY';
const lockConfirm='ACQUIRE_LOCAL_SETUP_LOCK_ONLY';
async function fixture(fn){
 const root=await mkdtemp(join(await realpath(tmpdir()),'itk-install-id-'));
 try{
  const directoryPath=join(root,'identity'),lockRoot=join(root,'locks');
  for(const dir of [directoryPath,lockRoot]){await mkdir(dir,{mode:0o700});await chmod(dir,0o700)}
  const input={confirmation:start,directoryPath},lock={confirmation:lockConfirm,lockRoot};
  const init=()=>initialize(input);
  const pin=r=>({confirmation:review,directoryPath,expectedInstallationId:r.installation_id,expectedIdentitySha256:r.identity_sha256});
  await fn({root,directoryPath,lockRoot,input,lock,init,pin,file:join(directoryPath,name)});
 }finally{await rm(root,{recursive:true,force:true})}
}
describe.skipIf(process.platform!=='linux')('private installation identity and cooperative setup lock',()=>{
 it('creates durable canonical identity, pins exact bytes and never grants runtime authority',()=>fixture(async x=>{
  const r=await x.init(),bytes=await readFile(x.file);
  expect(bytes.toString()).toBe(JSON.stringify({schema_version:1,installation_id:r.installation_id})+'\n');
  expect(r.identity_sha256).toBe(sha(bytes));expect((await lstat(x.file)).mode&0o7777).toBe(0o600);
  expect((await lstat(x.file)).nlink).toBe(1);
  expect(await inspect(x.pin(r))).toEqual({...r,identity_created:false});
  expect(r).toMatchObject({database_binding_verified:false,restore_authorized:false,installation_authorized:false,production_accepted:false});
  await expect(x.init()).rejects.toThrow('IDENTITY_DIRECTORY_NOT_EMPTY');
  expect(await readFile(x.file)).toEqual(bytes);
 }));
 it('creates distinct identities for two independent dedicated directories',()=>fixture(async x=>{
  const other=join(x.root,'other');await mkdir(other,{mode:0o700});await chmod(other,0o700);
  const a=await x.init(),b=await initialize({confirmation:start,directoryPath:other});
  expect(a.installation_id).not.toBe(b.installation_id);
 }));
 for(const confirmation of [undefined,null,false,true,'','initialize','INSPECT_PINNED_IDENTITY_STORE_ONLY'])
  it('refuses initialization confirmation '+String(confirmation),()=>fixture(async x=>{
   await expect(initialize({...x.input,confirmation})).rejects.toThrow('EXPLICIT_IDENTITY_INITIALIZATION_REQUIRED');
   expect(await readdir(x.directoryPath)).toEqual([]);
  }));
 for(const mode of [0o755,0o750,0o777,0o500,0o1700])
  it('refuses unsafe identity directory mode '+mode.toString(8),()=>fixture(async x=>{
   await chmod(x.directoryPath,mode);await expect(x.init()).rejects.toThrow('PRIVATE_IDENTITY_DIRECTORY_REQUIRED');
   await chmod(x.directoryPath,0o700);
  }));
 it('refuses linked identity directory',()=>fixture(async x=>{
  const alias=join(x.root,'alias');await symlink(x.directoryPath,alias);
  await expect(initialize({...x.input,directoryPath:alias})).rejects.toThrow();
 }));
 it('refuses interrupted temp file, never deletes it',()=>fixture(async x=>{
  const orphan=join(x.directoryPath,'.identity-abandoned.tmp');await writeFile(orphan,'interrupted');
  await expect(x.init()).rejects.toThrow('IDENTITY_DIRECTORY_NOT_EMPTY');expect(await readFile(orphan,'utf8')).toBe('interrupted');
 }));
 for(const [label,alter] of [
  ['missing confirmation',p=>({...p,confirmation:undefined})],['wrong confirmation',p=>({...p,confirmation:start})],
  ['missing digest',p=>({...p,expectedIdentitySha256:undefined})],['zero digest',p=>({...p,expectedIdentitySha256:'0'.repeat(64)})],
  ['uppercase digest',p=>({...p,expectedIdentitySha256:p.expectedIdentitySha256.toUpperCase()})],
  ['wrong digest',p=>({...p,expectedIdentitySha256:'a'.repeat(64)})],['wrong identity',p=>({...p,expectedInstallationId:randomUUID()})],
  ['missing identity',p=>({...p,expectedInstallationId:undefined})],['non-v4 identity',p=>({...p,expectedInstallationId:'00000000-0000-0000-0000-000000000000'})]
 ])it('refuses pinned read '+label,()=>fixture(async x=>{
  const r=await x.init(),before=await readFile(x.file);await expect(inspect(alter(x.pin(r)))).rejects.toThrow();
  expect(await readFile(x.file)).toEqual(before);
 }));
 for(const [label,change] of [
  ['changed UUID',async x=>writeFile(x.file,JSON.stringify({schema_version:1,installation_id:randomUUID()})+'\n')],
  ['truncated bytes',async x=>writeFile(x.file,'{')],['duplicate key',async x=>writeFile(x.file,(await readFile(x.file,'utf8')).replace('"schema_version":1','"schema_version":1,"schema_version":1'))],
  ['extra key',async x=>writeFile(x.file,(await readFile(x.file,'utf8')).replace('"schema_version":1','"schema_version":1,"secret":"x"'))],
  ['extra whitespace',async x=>writeFile(x.file,Buffer.concat([await readFile(x.file),Buffer.from('\n')]))],
  ['unsafe mode',async x=>chmod(x.file,0o644)],['special mode',async x=>chmod(x.file,0o4600)],
  ['hardlink',async x=>link(x.file,join(x.root,'alias'))],
  ['symlink',async x=>{await rm(x.file);await symlink(join(x.root,'missing'),x.file)}],
  ['unexpected sibling',async x=>writeFile(join(x.directoryPath,'orphan'),'x')],
  ['oversized',async x=>writeFile(x.file,'x'.repeat(257))],['missing file',async x=>rm(x.file)]
 ])it('refuses altered store '+label,()=>fixture(async x=>{
  const r=await x.init();await change(x);await expect(inspect(x.pin(r))).rejects.toThrow();
 }));
 it('serializes actual initialization through a lock without identity overwrite',()=>fixture(async x=>{
  const bytes=Buffer.from(JSON.stringify({directoryPath:x.directoryPath,lockRoot:x.lockRoot}));
  const results=await Promise.allSettled([runLocalIdentityCli(bytes,['--initialize-empty-store']),runLocalIdentityCli(bytes,['--initialize-empty-store'])]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const r=results.find(r=>r.status==='fulfilled').value;
  expect(await inspect(x.pin(r))).toEqual({...r,identity_created:false});
 }));
 it('holds exclusive lock while callback runs and releases after verified success',()=>fixture(async x=>{
  let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);
  const a=withLocalSetupLock(x.lock,async token=>{expect(token.lock_sha256).toMatch(/^[a-f0-9]{64}$/);enter();await held;return 'done'});
  await entered;
  try{await expect(withLocalSetupLock(x.lock,()=>{throw Error('must not enter')})).rejects.toThrow('SETUP_LOCK_RECONCILIATION_REQUIRED')}
  finally{release()}
  expect(await a).toBe('done');expect(await readdir(x.lockRoot)).toEqual([]);
  expect(await withLocalSetupLock(x.lock,async()=>42)).toBe(42);
 }));
 it('preserves interrupted lock on failed work and refuses automatic retry',()=>fixture(async x=>{
  await expect(withLocalSetupLock(x.lock,async()=>{throw Error('interrupted')})).rejects.toThrow('interrupted');
  const marker=join(x.lockRoot,'setup.lock','owner.json');
  expect((await lstat(marker)).mode&0o7777).toBe(0o600);
  await expect(withLocalSetupLock(x.lock,async()=>1)).rejects.toThrow('SETUP_LOCK_RECONCILIATION_REQUIRED');
 }));
 for(const [label,modify] of [
  ['marker bytes',async p=>writeFile(join(p,'owner.json'),'changed')],['marker mode',async p=>chmod(join(p,'owner.json'),0o644)],
  ['extra entry',async p=>writeFile(join(p,'unknown'),'x')],['missing marker',async p=>rm(join(p,'owner.json'))],
  ['lock permissions',async p=>chmod(p,0o755)]
 ])it('refuses release on changed '+label,()=>fixture(async x=>{
  await expect(withLocalSetupLock(x.lock,async()=>{await modify(join(x.lockRoot,'setup.lock'));return true})).rejects.toThrow();
  expect(await readdir(x.lockRoot)).toEqual(['setup.lock']);
 }));
 it('refuses preexisting lock or unrelated directory state',()=>fixture(async x=>{
  await mkdir(join(x.lockRoot,'setup.lock'));await expect(withLocalSetupLock(x.lock,()=>1)).rejects.toThrow('SETUP_LOCK_RECONCILIATION_REQUIRED');
  await rm(join(x.lockRoot,'setup.lock'),{recursive:true});await writeFile(join(x.lockRoot,'unknown'),'x');
  await expect(withLocalSetupLock(x.lock,()=>1)).rejects.toThrow('SETUP_LOCK_RECONCILIATION_REQUIRED');
 }));
 it('rejects wrong lock confirmation and non-function callback',()=>fixture(async x=>{
  await expect(withLocalSetupLock({...x.lock,confirmation:'wrong'},()=>1)).rejects.toThrow('EXPLICIT_SETUP_LOCK_REQUIRED');
  await expect(withLocalSetupLock(x.lock,null)).rejects.toThrow('EXPLICIT_SETUP_LOCK_REQUIRED');
  expect(await readdir(x.lockRoot)).toEqual([]);
 }));
 it('runs actual CLI initialization and pinned inspection',()=>fixture(async x=>{
  const script=fileURLToPath(new URL('../../scripts/local-installation-identity-cli.mjs',import.meta.url));
  const call=(arg,doc)=>spawnSync(process.execPath,[script,arg],{input:JSON.stringify(doc),encoding:'utf8',timeout:10000});
  const first=call('--initialize-empty-store',{directoryPath:x.directoryPath,lockRoot:x.lockRoot});
  expect(first.status).toBe(0);expect(first.stderr).toBe('');
  const r=JSON.parse(first.stdout),p=x.pin(r);delete p.confirmation;
  const second=call('--inspect-pinned-store',p);expect(second.status).toBe(0);
  expect(JSON.parse(second.stdout)).toEqual({...r,identity_created:false});
 }));
 for(const [label,build] of [
  ['missing argument',x=>[Buffer.from('{}'),[]]],['unknown argument',x=>[Buffer.from('{}'),['--force']]],
  ['oversized',x=>[Buffer.alloc(16385),['--initialize-empty-store']]],['invalid UTF8',x=>[Buffer.from([255]),['--initialize-empty-store']]],
  ['duplicate key',x=>[Buffer.from('{"directoryPath":"a","directoryPath":"b","lockRoot":"c"}'),['--initialize-empty-store']]],
  ['extra field',x=>[Buffer.from(JSON.stringify({directoryPath:x.directoryPath,lockRoot:x.lockRoot,installation_id:randomUUID()})),['--initialize-empty-store']]],
  ['overlap',x=>[Buffer.from(JSON.stringify({directoryPath:x.directoryPath,lockRoot:x.directoryPath})),['--initialize-empty-store']]],
  ['relative path',x=>[Buffer.from(JSON.stringify({directoryPath:'relative',lockRoot:x.lockRoot})),['--initialize-empty-store']]]
 ])it('rejects CLI '+label+' before writes',()=>fixture(async x=>{
  await expect(runLocalIdentityCli(...build(x))).rejects.toThrow('LOCAL_IDENTITY_INPUT_INVALID');
  expect(await readdir(x.directoryPath)).toEqual([]);expect(await readdir(x.lockRoot)).toEqual([]);
 }));
});
