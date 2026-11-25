// Fresh, local, exclusive-writer private PKI. No existing CA adoption,
// rotation, client trust installation, public DNS/ACME, or service start.
// Root signing key stays in a distinct owner-only directory; never mount it.
import {constants} from 'node:fs';
import {lstat,realpath,readdir,open,unlink} from 'node:fs/promises';
import {isAbsolute,resolve,relative,join} from 'node:path';
import {isIPv4} from 'node:net';
import {generateKeyPairSync,createHash,randomBytes,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {inspectLocalInstallationIdentity} from './installation-identity-store-posix.mjs';
import {validateInstallationIdentity} from './installation-identity.mjs';
import {inspectPrivateLanTlsMaterial} from './private-lan-tls-material.mjs';
const fail=()=>{throw Error('FRESH_PRIVATE_LAN_TLS_UNCONFIRMED')};
const exact=(o,ks)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const pathOk=p=>typeof p==='string'&&p.length<=4096&&isAbsolute(p)&&resolve(p)===p&&!/[\x00-\x1f\x7f,]/.test(p);
const within=(a,b)=>{const q=relative(a,b);return q===''||(!isAbsolute(q)&&q!=='..'&&!q.startsWith('../'))};
const sha=b=>createHash('sha256').update(b).digest('hex');
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const dirFields=['dev','ino','uid','gid','mode'],fileFields=[...dirFields,'size','nlink','mtimeMs','ctimeMs'];
const same=(a,b,fields)=>fields.every(k=>a[k]===b[k]);
const openssl='/usr/bin/openssl';
function validHost(h){
 return typeof h==='string'&&h.length<=253&&h.includes('.')&&/[a-z]/.test(h.split('.').at(-1))&&h.split('.').every(x=>x.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x)&&!/[\r\n]/.test(x))&&!/\.(localhost|local|test|example|invalid)$/.test(h);
}
function privateAddress(ip){
 if(typeof ip!=='string'||!isIPv4(ip))return false;
 const [a,b]=ip.split('.').map(Number);
 return a===10||a===127||a===172&&b>=16&&b<=31||a===192&&b===168;
}
export function validateFreshPrivateLanTlsPolicy(input){
 if(!exact(input,['confirmation','lockRoot','caDirectory','runtimeDirectory','address','hostname','identity'])||input.confirmation!=='PROVISION_EMPTY_PRIVATE_LAN_TLS_ONLY_EXCLUSIVE_WRITER_CUSTODY'||!privateAddress(input.address)||!validHost(input.hostname))fail();
 const i=input.identity;
 if(!exact(i,['confirmation','directoryPath','expectedInstallationId','expectedIdentitySha256'])||i.confirmation!=='INSPECT_PINNED_IDENTITY_STORE_ONLY'||!hex(i.expectedIdentitySha256))fail();
 validateInstallationIdentity({schema_version:1,installation_id:i.expectedInstallationId});
 const dirs=[input.lockRoot,input.caDirectory,input.runtimeDirectory,i.directoryPath];
 if(!dirs.every(pathOk)||dirs.some((a,n)=>dirs.some((b,m)=>m!==n&&within(a,b))))fail();
 return Object.freeze({...input,identity:Object.freeze({...i})});
}
// Separate LAN-only profile, not the public ACME Caddyfile or old mTLS
// template. Future ingress must independently admit this exact config and
// mount only this directory read-only; it must not mount the CA directory.
export function renderPrivateLanCaddyfile(hostname){
 if(!validHost(hostname))fail();
 return '{\n    admin off\n    auto_https off\n    servers {\n        protocols h1 h2\n    }\n}\n\nhttps://'+hostname+':443 {\n    tls /run/aaditech-tls/leaf.crt /run/aaditech-tls/leaf.key\n    @private path /metrics /docs /docs/* /redoc /redoc/* /openapi.json /api-docs /api-docs/*\n    respond @private 404\n    reverse_proxy api:3000\n}\n';
}
async function privateDir(path,uid,expected){
 const s=await lstat(path);
 if(!s.isDirectory()||s.uid!==uid||(s.mode&0o7777)!==0o700||await realpath(path)!==path||expected&&!same(s,expected,dirFields))fail();
 return s;
}
async function executable(){
 const s=await lstat(openssl);
 if(!s.isFile()||s.uid!==0||(s.mode&0o022)!==0||(s.mode&0o111)===0||await realpath(openssl)!==openssl)fail();
 return s;
}
async function createFile(path,bytes,uid){
 const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{
  await f.chmod(0o600);await f.writeFile(bytes);await f.sync();
  const s=await f.stat();
  if(!s.isFile()||s.uid!==uid||s.nlink!==1||(s.mode&0o7777)!==0o600||s.size!==bytes.length||!same(s,await lstat(path),fileFields))fail();
  return {stat:s,digest:sha(bytes)};
 }finally{await f.close()}
}
async function checkFile(path,record,uid){
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 let bytes;
 try{
  const s=await f.stat();
  if(!s.isFile()||s.uid!==uid||s.nlink!==1||(s.mode&0o7777)!==0o600||s.size<1||s.size>16384||!same(s,record.stat,fileFields))fail();
  bytes=Buffer.alloc(s.size+1);let n=0;
  while(n<bytes.length){const r=await f.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==s.size||sha(bytes.subarray(0,n))!==record.digest||!same(s,await f.stat(),fileFields)||!same(s,await lstat(path),fileFields))fail();
 }finally{if(bytes)bytes.fill(0);await f.close()}
}
async function syncDir(path,record){
 const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{if(!same(record,await f.stat(),dirFields))fail();await f.sync()}finally{await f.close()}
}
const serial=()=> '0x'+Buffer.concat([Buffer.from([1]),randomBytes(15)]).toString('hex');
export async function provisionFreshPrivateLanTls(input){
 const p=validateFreshPrivateLanTlsPolicy(input);
 if(process.platform!=='linux'||typeof process.geteuid!=='function')fail();
 const uid=process.geteuid(),ca=await privateDir(p.caDirectory,uid),runtime=await privateDir(p.runtimeDirectory,uid),bin=await executable();
 if((await readdir(p.caDirectory)).length||(await readdir(p.runtimeDirectory)).length)fail();
 await inspectLocalInstallationIdentity(p.identity);
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:p.lockRoot},async({assertHeld})=>{
  const records=new Map();
  async function guard(){
   await assertHeld();await privateDir(p.caDirectory,uid,ca);await privateDir(p.runtimeDirectory,uid,runtime);
   if(!same(bin,await executable(),fileFields))fail();
   await inspectLocalInstallationIdentity(p.identity);
   for(const [dir,record] of [[p.caDirectory,ca],[p.runtimeDirectory,runtime]]){
    const expected=[...records.keys()].filter(path=>path.startsWith(dir+'/')).map(path=>path.slice(dir.length+1)).sort();
    if(JSON.stringify((await readdir(dir)).sort())!==JSON.stringify(expected))fail();
    await privateDir(dir,uid,record);
   }
   for(const [path,record] of records)await checkFile(path,record,uid);
   await assertHeld();
  }
  async function put(path,bytes){
   await guard();records.set(path,await createFile(path,bytes,uid));await guard();
  }
  async function run(args){
   await guard();let result;
   try{result=execFileSync(openssl,args,{encoding:'buffer',timeout:15000,maxBuffer:16384,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',OPENSSL_CONF:'/dev/null'}})}catch{fail()}
   await guard();return result;
  }
  const rootKey=join(p.caDirectory,'root.key'),rootCert=join(p.caDirectory,'root.crt'),leafKey=join(p.runtimeDirectory,'leaf.key'),leafCert=join(p.runtimeDirectory,'leaf.crt'),csr=join(p.runtimeDirectory,'leaf.csr'),ext=join(p.runtimeDirectory,'leaf.ext'),config=join(p.runtimeDirectory,'Caddyfile');
  try{
   await guard();
   const root=generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:65537}),leaf=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
   for(const [path,key] of [[rootKey,root.privateKey],[leafKey,leaf.privateKey]]){
    const bytes=Buffer.from(key.export({type:'pkcs8',format:'pem'}));
    try{await put(path,bytes)}finally{bytes.fill(0)}
   }
   const rootBytes=await run(['req','-new','-x509','-config','/dev/null','-key',rootKey,'-subj','/CN=AadiTech installation '+p.identity.expectedInstallationId,'-days','3650','-sha256','-set_serial',serial(),'-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign','-addext','subjectKeyIdentifier=hash']);
   const rootX=new X509Certificate(rootBytes),rootPem=rootBytes.toString('ascii'),rootPin=sha(rootX.raw);
   if(!rootX.ca||!rootX.checkPrivateKey(root.privateKey)||!rootX.verify(rootX.publicKey)||!rootX.checkIssued(rootX))fail();
   await put(rootCert,rootBytes);
   await put(csr,await run(['req','-new','-config','/dev/null','-key',leafKey,'-subj','/CN='+p.hostname,'-sha256']));
   await put(ext,Buffer.from('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:'+p.hostname+'\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n'));
   await put(leafCert,await run(['x509','-req','-in',csr,'-CA',rootCert,'-CAkey',rootKey,'-set_serial',serial(),'-days','90','-sha256','-extfile',ext]));
   const proof=await inspectPrivateLanTlsMaterial({confirmation:'INSPECT_PRIVATE_TLS_MATERIAL_ONLY',address:p.address,hostname:p.hostname,port:443,rootPem,trustedRootSha256:rootPin,leafCertificatePath:leafCert,privateKeyPath:leafKey});
   if(!proof.direct_root_signature_verified||!proof.exact_san_verified||!proof.key_match_verified||!proof.server_auth_eku_verified||!proof.local_tls_context_created)fail();
   for(const path of [csr,ext]){await guard();await checkFile(path,records.get(path),uid);await unlink(path);records.delete(path);await guard()}
   await put(config,Buffer.from(renderPrivateLanCaddyfile(p.hostname)));
   await syncDir(p.caDirectory,ca);await syncDir(p.runtimeDirectory,runtime);await guard();
   return Object.freeze({schema_version:1,installation_id:p.identity.expectedInstallationId,identity_sha256:p.identity.expectedIdentitySha256,hostname:p.hostname,root_sha256:rootPin,leaf_sha256:proof.leaf_sha256,caddyfile_sha256:records.get(config).digest,root_key_separate:true,private_material_verified:true,caddy_config_rendered:true,leaf_validity_days:90,root_validity_days:3650,endpoint_handshake_verified:false,client_trust_installed:false,ingress_started:false,installation_authorized:false,production_accepted:false});
  }catch{fail()}
 });
}

// Re-admit exact local runtime files using independently recorded public
// fingerprints. Do not read or mount the CA signing key. The caller must
// retain exclusive writer custody across inspection and activation.
export async function inspectPinnedPrivateLanRuntime(input,assertHeld){
 try{
  if(!exact(input,['confirmation','runtimeDirectory','address','hostname','identity','rootPem','trustedRootSha256','trustedLeafSha256','trustedCaddyfileSha256'])||input.confirmation!=='INSPECT_PINNED_PRIVATE_LAN_RUNTIME_ONLY'||typeof assertHeld!=='function'||process.platform!=='linux'||typeof process.geteuid!=='function'||!pathOk(input.runtimeDirectory)||!privateAddress(input.address)||!validHost(input.hostname)||!hex(input.trustedRootSha256)||!hex(input.trustedLeafSha256)||!hex(input.trustedCaddyfileSha256))fail();
  const identity=input.identity;
  if(!exact(identity,['confirmation','directoryPath','expectedInstallationId','expectedIdentitySha256'])||identity.confirmation!=='INSPECT_PINNED_IDENTITY_STORE_ONLY'||!pathOk(identity.directoryPath)||within(input.runtimeDirectory,identity.directoryPath)||within(identity.directoryPath,input.runtimeDirectory)||!hex(identity.expectedIdentitySha256))fail();
  const p=Object.freeze({...input,identity:Object.freeze({...identity})});
  const uid=process.geteuid(),dir=await privateDir(p.runtimeDirectory,uid);
  const names=['Caddyfile','leaf.crt','leaf.key'],records=new Map();
  async function guard(){
   await assertHeld();await privateDir(p.runtimeDirectory,uid,dir);
   if(JSON.stringify((await readdir(p.runtimeDirectory)).sort())!==JSON.stringify(names))fail();
   for(const [path,record] of records)await checkFile(path,record,uid);
   await inspectLocalInstallationIdentity(p.identity);
   await assertHeld();
  }
  await guard();
  for(const name of names){
   const path=join(p.runtimeDirectory,name),f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   let bytes;
   try{
    const s=await f.stat();
    if(!s.isFile()||s.uid!==uid||s.nlink!==1||(s.mode&0o7777)!==0o600||s.size<1||s.size>16384)fail();
    bytes=Buffer.alloc(s.size+1);let n=0;
    while(n<bytes.length){const r=await f.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
    if(n!==s.size||!same(s,await f.stat(),fileFields)||!same(s,await lstat(path),fileFields))fail();
    const content=bytes.subarray(0,n),digest=sha(content);
    if(name==='Caddyfile'&&(digest!==p.trustedCaddyfileSha256||!content.equals(Buffer.from(renderPrivateLanCaddyfile(p.hostname)))))fail();
    records.set(path,{stat:s,digest});
   }finally{if(bytes)bytes.fill(0);await f.close()}
  }
  await guard();
  const proof=await inspectPrivateLanTlsMaterial({confirmation:'INSPECT_PRIVATE_TLS_MATERIAL_ONLY',address:p.address,hostname:p.hostname,port:443,rootPem:p.rootPem,trustedRootSha256:p.trustedRootSha256,leafCertificatePath:join(p.runtimeDirectory,'leaf.crt'),privateKeyPath:join(p.runtimeDirectory,'leaf.key')});
  if(proof.leaf_sha256!==p.trustedLeafSha256||!proof.direct_root_signature_verified||!proof.key_match_verified||!proof.exact_san_verified||!proof.server_auth_eku_verified)fail();
  await guard();
  return Object.freeze({schema_version:1,source:p.runtimeDirectory,target:'/run/aaditech-tls',dev:dir.dev,ino:dir.ino,root_sha256:p.trustedRootSha256,leaf_sha256:p.trustedLeafSha256,caddyfile_sha256:p.trustedCaddyfileSha256,identity_sha256:p.identity.expectedIdentitySha256,private_material_verified:true,ingress_started:false,production_accepted:false});
 }catch{fail()}
}
