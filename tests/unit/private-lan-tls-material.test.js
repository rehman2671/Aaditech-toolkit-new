import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {createHash,X509Certificate} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,chmod,writeFile,readFile,rm,realpath,link,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectPrivateLanTlsMaterial as inspect} from '../../scripts/private-lan-tls-material.mjs';
import {runPrivateTlsMaterialCli} from '../../scripts/private-lan-tls-material-cli.mjs';
describe.skipIf(process.platform!=='linux')('private LAN TLS material custody and offline compatibility',()=>{
 let source,rootPem,pin;
 beforeAll(async()=>{
  source=await mkdtemp(join(await realpath(tmpdir()),'itk-material-'));
  const run=(...args)=>execFileSync('openssl',args,{cwd:source,stdio:'ignore',timeout:10000});
  for(const n of ['ca','wrong'])run('req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Fixture '+n,
   '-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',n+'.key','-out',n+'.crt');
  run('req','-newkey','rsa:2048','-nodes','-subj','/CN=office.internal','-keyout','leaf.key','-out','leaf.csr');
  for(const [name,san,eku,issuer] of [['good','DNS:office.internal,IP:127.0.0.1','serverAuth','ca'],['wild','DNS:*.internal','serverAuth','ca'],
   ['cn',null,'serverAuth','ca'],['client','DNS:office.internal','clientAuth','ca'],['noeku','DNS:office.internal',null,'ca'],['wrongleaf','DNS:office.internal','serverAuth','wrong']]){
   await writeFile(join(source,name+'.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n'+
    (eku?'extendedKeyUsage='+eku+'\n':'')+(san?'subjectAltName='+san+'\n':''));
   run('x509','-req','-in','leaf.csr','-CA',issuer+'.crt','-CAkey',issuer+'.key','-CAcreateserial','-days','1','-extfile',name+'.ext','-out',name+'.crt');
  }
  rootPem=await readFile(join(source,'ca.crt'),'utf8');pin=createHash('sha256').update(new X509Certificate(rootPem).raw).digest('hex');
 },30000);
 afterAll(async()=>{if(source)await rm(source,{recursive:true,force:true})});
 async function fixture(fn){
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-material-pair-'));
  try{
   await chmod(dir,0o700);
   const leafCertificatePath=join(dir,'leaf.crt'),privateKeyPath=join(dir,'leaf.key');
   await writeFile(leafCertificatePath,await readFile(join(source,'good.crt')),{mode:0o600});
   await writeFile(privateKeyPath,await readFile(join(source,'leaf.key')),{mode:0o600});
   const opts={confirmation:'INSPECT_PRIVATE_TLS_MATERIAL_ONLY',address:'127.0.0.1',hostname:'office.internal',port:443,
    rootPem,trustedRootSha256:pin,leafCertificatePath,privateKeyPath};
   await fn(opts,dir);
  }finally{await rm(dir,{recursive:true,force:true})}
 }
 it('verifies real direct-root DNS SAN, server EKU, private key match and local secure context without opening a listener',()=>fixture(async opts=>{
  const r=await inspect(opts);expect(r).toMatchObject({direct_root_signature_verified:true,exact_san_verified:true,server_auth_eku_verified:true,
    key_match_verified:true,local_tls_context_created:true,endpoint_handshake_verified:false,revocation_verified:false,production_accepted:false});
  expect(JSON.stringify(r)).not.toContain(opts.privateKeyPath);
 }));
 it('accepts matching exact private IP SAN',()=>fixture(async opts=>expect((await inspect({...opts,hostname:'127.0.0.1'})).exact_san_verified).toBe(true)));
 for(const n of ['wild','cn','client','noeku','wrongleaf'])it('rejects '+n+' signed leaf',()=>fixture(async opts=>{
  await writeFile(opts.leafCertificatePath,await readFile(join(source,n+'.crt')));await expect(inspect(opts)).rejects.toThrow('TLS_LEAF_POLICY_INVALID');
 }));
 for(const [name,change] of [
  ['missing confirmation',async o=>({...o,confirmation:undefined})],
  ['public address',async o=>({...o,address:'8.8.8.8'})],
  ['wrong hostname',async o=>({...o,hostname:'other.internal'})],
  ['wrong root pin',async o=>({...o,trustedRootSha256:'a'.repeat(64)})],
  ['wrong key',async o=>{await writeFile(o.privateKeyPath,await readFile(join(source,'ca.key')));return o}],
  ['CA as leaf',async o=>{await writeFile(o.leafCertificatePath,await readFile(join(source,'ca.crt')));return o}],
  ['certificate chain concatenation',async o=>{await writeFile(o.leafCertificatePath,(await readFile(o.leafCertificatePath,'utf8'))+rootPem);return o}],
  ['key concatenation',async o=>{const k=await readFile(o.privateKeyPath);await writeFile(o.privateKeyPath,Buffer.concat([k,k]));return o}],
  ['key mode too broad',async o=>{await chmod(o.privateKeyPath,0o644);return o}],
  ['certificate mode too broad',async o=>{await chmod(o.leafCertificatePath,0o644);return o}],
  ['directory mode too broad',async (o,d)=>{await chmod(d,0o755);return o}],
  ['hardlink key',async (o,d)=>{await link(o.privateKeyPath,join(d,'alias'));return o}],
  ['symlink key',async (o,d)=>{const p=join(d,'alias');await symlink(o.privateKeyPath,p);return {...o,privateKeyPath:p}}],
  ['same path',async o=>({...o,privateKeyPath:o.leafCertificatePath})],
  ['relative path',async o=>({...o,privateKeyPath:'leaf.key'})],
  ['oversized key',async o=>{await writeFile(o.privateKeyPath,Buffer.alloc(16385));return o}]
 ])it('refuses '+name,()=>fixture(async (o,d)=>{await expect(inspect(await change(o,d))).rejects.toThrow()}));
 it('CLI uses local paths and public root only, rejects duplicate keys and secret fields',()=>fixture(async o=>{
  const {confirmation,...doc}=o,raw=JSON.stringify(doc),flags=['--confirm-local-read-only'];
  const script=fileURLToPath(new URL('../../scripts/private-lan-tls-material-cli.mjs',import.meta.url));
  const child=spawnSync(process.execPath,[script,...flags],{input:raw,encoding:'utf8',timeout:15000});
  expect(child.status).toBe(0);expect(child.stderr).toBe('');expect(JSON.parse(child.stdout).key_match_verified).toBe(true);
  expect(child.stdout).not.toContain(o.privateKeyPath);expect(child.stdout).not.toContain('PRIVATE KEY');
  for(const [bytes,args] of [[Buffer.from(raw),[]],[Buffer.alloc(32769),flags],[Buffer.from([255]),flags],
   [Buffer.from(raw.replace('"port":443','"port":443,"port":443')),flags],[Buffer.from(JSON.stringify({...doc,privateKey:'secret'})),flags]])
   await expect(runPrivateTlsMaterialCli(bytes,args)).rejects.toThrow('TLS_MATERIAL_INPUT_INVALID');
 }));
});
