// Durable local installation identity custody, not a live database binding.
// Dedicated trusted local directory, exclusive operator custody required.
// Never adopt existing state, replace an identity or authorize installation.
import {constants} from 'node:fs';
import {open,lstat,realpath,readdir,link,unlink} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {validateInstallationIdentity} from './installation-identity.mjs';
const fail=code=>{throw Error(code)};
const name='installation-identity.json';
const digest=b=>createHash('sha256').update(b).digest('hex');
const validDigest=v=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/.test(v)&&!/^0+$/.test(v);
const same=(a,b)=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const encode=v=>Buffer.from(JSON.stringify(validateInstallationIdentity(v))+'\n');
async function directory(path,previous){
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||!constants.O_NOFOLLOW||
    typeof path!=='string'||path.length>4096||!isAbsolute(path)||resolve(path)!==path||path.includes('\0'))
  fail('PRIVATE_IDENTITY_DIRECTORY_REQUIRED');
 const st=await lstat(path);
 if(!st.isDirectory()||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o700||await realpath(path)!==path||
  (previous&&['dev','ino','uid','mode'].some(k=>st[k]!==previous[k])))fail('PRIVATE_IDENTITY_DIRECTORY_REQUIRED');
 return st;
}
async function syncDir(path,original){
 const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{
  const s=await fd.stat();
  if(['dev','ino','uid','mode'].some(k=>s[k]!==original[k]))fail('IDENTITY_DIRECTORY_CHANGED');
  await fd.sync();
 }finally{await fd.close()}
}
async function readCurrent(path,original){
 await directory(path,original);
 const names=await readdir(path);
 if(names.length!==1||names[0]!==name)fail('IDENTITY_DIRECTORY_RECONCILIATION_REQUIRED');
 const file=join(path,name),before=await lstat(file);
 if(!before.isFile()||before.nlink!==1||before.uid!==process.geteuid()||(before.mode&0o7777)!==0o600||
    before.size<1||before.size>256)fail('IDENTITY_FILE_INVALID');
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(before,await fd.stat()))fail('IDENTITY_FILE_CHANGED');
  const b=Buffer.alloc(before.size+1);let n=0;
  while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==before.size||!same(before,await fd.stat())||!same(before,await lstat(file)))fail('IDENTITY_FILE_CHANGED');
  const bytes=b.subarray(0,n);
  const value=validateInstallationIdentity(JSON.parse(bytes.toString('utf8')));
  if(!bytes.equals(encode(value)))fail('IDENTITY_FILE_INVALID');
  await directory(path,original);
  const after=await readdir(path);
  if(after.length!==1||after[0]!==name||!same(before,await lstat(file)))fail('IDENTITY_FILE_CHANGED');
  return {value,sha256:digest(bytes)};
 }finally{await fd.close()}
}
function receipt(record,created){
 return Object.freeze({schema_version:1,installation_id:record.value.installation_id,
  identity_sha256:record.sha256,identity_created:created,local_identity_verified:true,
  database_binding_verified:false,existing_installation_reconciled:false,
  restore_authorized:false,installation_authorized:false,production_accepted:false});
}
export async function initializeLocalInstallationIdentity({confirmation,directoryPath}={}){
 if(confirmation!=='INITIALIZE_EMPTY_IDENTITY_STORE_ONLY')fail('EXPLICIT_IDENTITY_INITIALIZATION_REQUIRED');
 const original=await directory(directoryPath);
 if((await readdir(directoryPath)).length!==0)fail('IDENTITY_DIRECTORY_NOT_EMPTY');
 const value=validateInstallationIdentity({schema_version:1,installation_id:randomUUID()}),bytes=encode(value);
 const temp=join(directoryPath,'.identity-'+randomUUID()+'.tmp');
 let fd,created=false,published=false;
 try{
  fd=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  created=true;await fd.chmod(0o600);await fd.writeFile(bytes);await fd.sync();await fd.close();fd=null;
  await directory(directoryPath,original);
  // Refuse any intervening entries. The exclusive link is the final fence
  // against concurrent initializers; never overwrite or remove a winner.
  const names=await readdir(directoryPath);
  if(names.length!==1||join(directoryPath,names[0])!==temp)fail('IDENTITY_DIRECTORY_NOT_EMPTY');
  await link(temp,join(directoryPath,name));published=true;
 }finally{
  if(fd)await fd.close();
  if(created){await directory(directoryPath,original);await unlink(temp)}
 }
 // If this fails after publication, preserve the identity for operator
 // reconciliation; never regenerate on retry or claim successful durability.
 if(!published)fail('IDENTITY_PUBLICATION_UNCONFIRMED');
 await syncDir(directoryPath,original);
 const record=await readCurrent(directoryPath,original);
 if(record.sha256!==digest(bytes)||record.value.installation_id!==value.installation_id)fail('IDENTITY_FILE_CHANGED');
 return receipt(record,true);
}
export async function inspectLocalInstallationIdentity({confirmation,directoryPath,expectedInstallationId,expectedIdentitySha256}={}){
 if(confirmation!=='INSPECT_PINNED_IDENTITY_STORE_ONLY'||!validDigest(expectedIdentitySha256))fail('EXPLICIT_PINNED_IDENTITY_REQUIRED');
 const expected=validateInstallationIdentity({schema_version:1,installation_id:expectedInstallationId});
 const original=await directory(directoryPath),record=await readCurrent(directoryPath,original);
 if(record.sha256!==expectedIdentitySha256||record.value.installation_id!==expected.installation_id)fail('IDENTITY_PIN_MISMATCH');
 return receipt(record,false);
}
