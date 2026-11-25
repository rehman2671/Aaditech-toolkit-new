import {it,expect,describe} from 'vitest';
import {mkdtemp,mkdir,readdir,readFile,rm,realpath,lstat,writeFile,chmod,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
import {createServer} from 'node:tls';
import {initializeLocalInstallationIdentity} from '../../scripts/installation-identity-store-posix.mjs';
import {validateFreshPrivateLanTlsPolicy as validate,renderPrivateLanCaddyfile as render,provisionFreshPrivateLanTls as provision,inspectPinnedPrivateLanRuntime as admit} from '../../scripts/provision-fresh-private-lan-tls.mjs';
import {probePrivateTls} from '../../scripts/private-lan-tls-preflight.mjs';
const policy={confirmation:'PROVISION_EMPTY_PRIVATE_LAN_TLS_ONLY_EXCLUSIVE_WRITER_CUSTODY',lockRoot:'/private/lock',caDirectory:'/private/ca',runtimeDirectory:'/private/runtime',address:'127.0.0.1',hostname:'office.internal',identity:{confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:'/private/identity',expectedInstallationId:'12345678-1234-4234-8234-123456789abc',expectedIdentitySha256:'a'.repeat(64)}};
it('admits separate private storage and freezes identity pins',()=>{expect(validate(policy)).toEqual(policy);expect(Object.isFrozen(validate(policy).identity)).toBe(true)});
it.each(['8.8.8.8','169.254.1.2','172.32.0.2','::1','localhost','127.000.0.1',null])('rejects nonprivate or invalid address %j',address=>expect(()=>validate({...policy,address})).toThrow());
it.each(['*.internal','office.local','office.test','office.example','office.invalid','office.localhost','office.internal\n','office.internal\r','office.internal:443','https://office.internal','office.internal/','office..internal','office.internal {','127.0.0.1','UPPER.internal','a'.repeat(64)+'.internal',null])('rejects invalid or incompatible DNS hostname %j',hostname=>{
 expect(()=>validate({...policy,hostname})).toThrow();expect(()=>render(hostname)).toThrow();
});
it.each([{confirmation:'yes'},{caDirectory:policy.runtimeDirectory},{runtimeDirectory:policy.caDirectory+'/leaf'},{lockRoot:'/private'},{runtimeDirectory:'relative'},{caDirectory:'/private/ca,other'},{identity:{...policy.identity,expectedIdentitySha256:'0'.repeat(64)}},{identity:{...policy.identity,directoryPath:policy.caDirectory+'/identity'}},{extra:true}])('rejects unsafe provisioning policy %j',patch=>expect(()=>validate({...policy,...patch})).toThrow());
it('renders only a private explicit TLS site with no ACME, HTTP redirect, admin listener, root key or metrics exposure',()=>{
 const c=render('office.internal');
 expect(c).toContain('https://office.internal:443');expect(c).toContain('auto_https off');expect(c).toContain('admin off');expect(c).toContain('protocols h1 h2');
 expect(c).toContain('tls /run/aaditech-tls/leaf.crt /run/aaditech-tls/leaf.key');expect(c).toContain('reverse_proxy api:3000');
 expect(c).toContain('respond @private 404');expect(c).not.toContain('root.key');expect(c).not.toContain('tls internal');expect(c).not.toContain(':80');
});
describe.skipIf(process.platform!=='linux')('actual disposable local PKI provisioning',()=>{
 async function fixture(fn){
  const root=await mkdtemp(join(await realpath(tmpdir()),'aaditech-private-pki-'));
  try{
   const dirs=Object.fromEntries(['lockRoot','caDirectory','runtimeDirectory','identity'].map(k=>[k,join(root,k)]));
   for(const path of Object.values(dirs))await mkdir(path,{mode:0o700});
   const id=await initializeLocalInstallationIdentity({confirmation:'INITIALIZE_EMPTY_IDENTITY_STORE_ONLY',directoryPath:dirs.identity,observed:{database:'absent',credentials:'absent',service:'absent'}});
   const opts={...policy,lockRoot:dirs.lockRoot,caDirectory:dirs.caDirectory,runtimeDirectory:dirs.runtimeDirectory,identity:{...policy.identity,directoryPath:dirs.identity,expectedInstallationId:id.installation_id,expectedIdentitySha256:id.identity_sha256}};
   await fn(opts);
  }finally{await rm(root,{recursive:true,force:true})}
 }
 it('generates actual direct-root certs and a local TLS handshake, without CA key in runtime or trust-store mutation',()=>fixture(async opts=>{
  const proof=await provision(opts);
  expect(proof).toMatchObject({root_key_separate:true,private_material_verified:true,caddy_config_rendered:true,endpoint_handshake_verified:false,client_trust_installed:false,ingress_started:false,production_accepted:false});
  expect((await readdir(opts.caDirectory)).sort()).toEqual(['root.crt','root.key']);
  expect((await readdir(opts.runtimeDirectory)).sort()).toEqual(['Caddyfile','leaf.crt','leaf.key']);
  expect(await readdir(opts.lockRoot)).toEqual([]);
  for(const [dir,names] of [[opts.caDirectory,['root.crt','root.key']],[opts.runtimeDirectory,['Caddyfile','leaf.crt','leaf.key']]])for(const name of names){
   const s=await lstat(join(dir,name));expect(s.mode&0o7777).toBe(0o600);expect(s.nlink).toBe(1);
  }
  const rootPem=await readFile(join(opts.caDirectory,'root.crt'),'utf8'),key=await readFile(join(opts.runtimeDirectory,'leaf.key')),cert=await readFile(join(opts.runtimeDirectory,'leaf.crt'));
  expect(createHash('sha256').update(new X509Certificate(rootPem).raw).digest('hex')).toBe(proof.root_sha256);
  expect(createHash('sha256').update(new X509Certificate(cert).raw).digest('hex')).toBe(proof.leaf_sha256);
  expect(createHash('sha256').update(await readFile(join(opts.runtimeDirectory,'Caddyfile'))).digest('hex')).toBe(proof.caddyfile_sha256);
  expect(JSON.stringify(proof)).not.toContain('PRIVATE KEY');
  const server=createServer({cert,key,minVersion:'TLSv1.2'},socket=>socket.end());
  try{
   await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
   const target={confirmation:'PROBE_PRIVATE_TLS_ONLY',address:'127.0.0.1',hostname:opts.hostname,port:server.address().port,rootPem,trustedRootSha256:proof.root_sha256};
   expect(await probePrivateTls(target)).toMatchObject({chain_verified:true,exact_san_verified:true,server_auth_eku_verified:true,application_readiness_verified:false});
   await expect(probePrivateTls({...target,hostname:'other.internal'})).rejects.toThrow();
  }finally{key.fill(0);await new Promise(ok=>server.close(ok))}
  const input={confirmation:'INSPECT_PINNED_PRIVATE_LAN_RUNTIME_ONLY',runtimeDirectory:opts.runtimeDirectory,address:opts.address,hostname:opts.hostname,identity:opts.identity,rootPem,trustedRootSha256:proof.root_sha256,trustedLeafSha256:proof.leaf_sha256,trustedCaddyfileSha256:proof.caddyfile_sha256};
  const guard=async()=>{};
  expect(await admit(input,guard)).toMatchObject({private_material_verified:true,target:'/run/aaditech-tls',production_accepted:false});
  for(const field of ['trustedRootSha256','trustedLeafSha256','trustedCaddyfileSha256'])await expect(admit({...input,[field]:'b'.repeat(64)},guard)).rejects.toThrow();
  const extra=join(opts.runtimeDirectory,'unexpected');await writeFile(extra,'sentinel',{mode:0o600});
  await expect(admit(input,guard)).rejects.toThrow();await unlink(extra);
  const config=join(opts.runtimeDirectory,'Caddyfile');await writeFile(config,render(opts.hostname)+'# drift\n');
  await expect(admit(input,guard)).rejects.toThrow();
  await writeFile(config,render(opts.hostname));
  await chmod(join(opts.runtimeDirectory,'leaf.key'),0o644);
  await expect(admit(input,guard)).rejects.toThrow();await chmod(join(opts.runtimeDirectory,'leaf.key'),0o600);
  await expect(provision(opts)).rejects.toThrow();
  expect(await readdir(opts.lockRoot)).toEqual([]);
 }),30000);
 it.each(['occupied CA','occupied runtime','unsafe mode','identity mismatch','symlink leaf'])('refuses unsafe existing target: %s',reason=>fixture(async opts=>{
  let input=opts;
  if(reason==='occupied CA')await writeFile(join(opts.caDirectory,'existing'),'sentinel');
  if(reason==='occupied runtime')await writeFile(join(opts.runtimeDirectory,'existing'),'sentinel');
  if(reason==='unsafe mode')await chmod(opts.runtimeDirectory,0o755);
  if(reason==='identity mismatch')input={...opts,identity:{...opts.identity,expectedIdentitySha256:'b'.repeat(64)}};
  if(reason==='symlink leaf')await symlink(join(opts.caDirectory,'nonexistent'),join(opts.runtimeDirectory,'leaf.key'));
  await expect(provision(input)).rejects.toThrow();expect(await readdir(opts.lockRoot)).toEqual([]);
  if(reason==='occupied CA')expect(await readFile(join(opts.caDirectory,'existing'),'utf8')).toBe('sentinel');
  if(reason==='occupied runtime')expect(await readFile(join(opts.runtimeDirectory,'existing'),'utf8')).toBe('sentinel');
 }));
});
