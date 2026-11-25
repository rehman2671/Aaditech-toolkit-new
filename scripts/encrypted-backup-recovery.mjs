// Bounded POSIX reference encryption/recovery. Not a live database backup
// or restore executor. Caller holds exclusive trusted staging lock.
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,realpath,open,link,unlink} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {validateInstallationIdentity} from './installation-identity.mjs';
import {canonicalBackupManifest,verifyAuthenticatedBackup,snapshotBackupInputs} from './authenticated-backup-preflight.mjs';

export const MAX_PLAINTEXT_BYTES=64*1024*1024;
const MAGIC=Buffer.from('ITKBAK01','ascii');
const HEADER=8+36+36+12;
const TAG=16;
const digest=b=>createHash('sha256').update(b).digest('hex');
const uuid=s=>validateInstallationIdentity({schema_version:1,installation_id:s}).installation_id;
function keyCopy(key) {
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('EXTERNAL_256_BIT_KEY_REQUIRED');
  return Buffer.from(key);
}
async function privateDir(directory) {
  if(typeof process.geteuid!=='function'||!constants.O_NOFOLLOW)throw Error('POSIX_PRIVATE_STORAGE_REQUIRED');
  if(typeof directory!=='string'||directory.length>4096||!isAbsolute(directory)||
     /[\x00-\x1f\x7f]/.test(directory)||resolve(directory)!==directory)throw Error('PRIVATE_STAGING_REQUIRED');
  const full=directory,st=await lstat(full);
  if(!st.isDirectory()||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o700||
     await realpath(full)!==full)throw Error('PRIVATE_STAGING_REQUIRED');
  return {full,st};
}
const sameDirectory=(a,b)=>['dev','ino','uid','mode'].every(k=>a[k]===b[k]);
async function assertDirectory(record){
 const now=await privateDir(record.full);
 if(!sameDirectory(record.st,now.st))throw Error('PRIVATE_STAGING_CHANGED');
}
function filename(name) {
  if(typeof name!=='string'||name.length>128||! /^[A-Za-z0-9][A-Za-z0-9_.-]*(?![\s\S])/.test(name)||name.endsWith('.'))
    throw Error('LOCAL_STAGING_FILENAME_REQUIRED');
  return name;
}
async function readPrivate(directory,name,max) {
  const path=join(directory,filename(name));
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let buf;
  try{
    const st=await fd.stat();
    if(!st.isFile()||st.nlink!==1||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o600||
       st.size<1||st.size>max)throw Error('PRIVATE_INPUT_OR_SIZE_INVALID');
    buf=Buffer.alloc(st.size+1);
    let count=0;
    while(count<buf.length){
      const {bytesRead}=await fd.read(buf,count,buf.length-count,count);
      if(!bytesRead)break;
      count+=bytesRead;
    }
    const end=await fd.stat(),cur=await lstat(path);
    if(count!==st.size||!end.isFile()||!cur.isFile()||
       [end,cur].some(x=>x.nlink!==1||x.uid!==st.uid||x.mode!==st.mode||
         ['dev','ino','size','ctimeMs','mtimeMs'].some(k=>x[k]!==st[k])))throw Error('INPUT_CHANGED');
    return buf.subarray(0,count);
  }catch(e){if(buf)buf.fill(0);throw e}
  finally{await fd.close()}
}
async function publish(record,name,bytes) {
  const directory=record.full;
  await assertDirectory(record);
  const dest=join(directory,filename(name)),tmp=join(directory,'.backup-'+randomUUID()+'.tmp');
  let fd,created=false;
  try{
    fd=await open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    created=true;
    await fd.chmod(0o600);await fd.writeFile(bytes);await fd.sync();await fd.close();fd=null;
    await assertDirectory(record);
    await link(tmp,dest); // exclusive, no overwrite of existing destination
  }finally{
    if(fd)await fd.close();
    if(created){await assertDirectory(record);await unlink(tmp)}
  }
  const dirfd=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{if(!sameDirectory(record.st,await dirfd.stat()))throw Error('PRIVATE_STAGING_CHANGED');await dirfd.sync()}finally{await dirfd.close()}
}
export async function createEncryptedBackup({directory,inputName,outputName,key,installationId,backupId,createdAt}) {
  const secret=keyCopy(key);
  let plaintext;
  try{
    const id=uuid(installationId),bid=uuid(backupId);
    filename(inputName);filename(outputName);
    const record=await privateDir(directory),dir=record.full;
    if(inputName===outputName)throw Error('DISTINCT_OUTPUT_REQUIRED');
    plaintext=await readPrivate(dir,inputName,MAX_PLAINTEXT_BYTES);
    const nonce=randomBytes(12);
    const header=Buffer.concat([MAGIC,Buffer.from(id,'ascii'),Buffer.from(bid,'ascii'),nonce]);
    const cipher=createCipheriv('aes-256-gcm',secret,nonce,{authTagLength:TAG});
    cipher.setAAD(header);
    const encrypted=Buffer.concat([header,cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
    const manifest=canonicalBackupManifest({schema_version:1,installation_id:id,backup_id:bid,
      created_at:createdAt,format:'encrypted-backup-container',payload_size:encrypted.length,
      payload_sha256:digest(encrypted)});
    await publish(record,outputName,encrypted);
    // Unsigned manifest bytes are returned for independent signer custody.
    // Nothing is submitted to a signer or claimed authenticated here.
    return {manifest,encrypted_payload_created:true,manifest_signed:false,restore_authorized:false};
  }finally{secret.fill(0);if(plaintext)plaintext.fill(0)}
}

export async function recoverEncryptedBackup({directory,outputName,key,backup,expectedBackupId,confirmation}) {
  if(confirmation!=='RECOVER_TO_PRIVATE_STAGING_ONLY')throw Error('EXPLICIT_STAGING_RECOVERY_REQUIRED');
  const secret=keyCopy(key);
  let plain,partial,last;
  try{
    filename(outputName);
    const bid=uuid(expectedBackupId),snapshot=snapshotBackupInputs(backup);
    const record=await privateDir(directory),dir=record.full;
    // Enforce bounded format before full verifier hashes potentially huge files.
    // Read the exact ciphertext into memory once, then compare that snapshot
    // against independently authenticated manifest evidence before decrypting.
    const payload=snapshot.payloadPath;
    const name=filename(payload.slice(dir.length+1));
    if(join(dir,name)!==payload||name===outputName)throw Error('PRIVATE_PAYLOAD_REQUIRED');
    const encrypted=await readPrivate(dir,name,MAX_PLAINTEXT_BYTES+HEADER+TAG);
    const evidence=await verifyAuthenticatedBackup(snapshot);
    if(evidence.backup_id!==bid||evidence.payload_size!==encrypted.length||
       evidence.payload_sha256!==digest(encrypted))throw Error('APPROVED_BACKUP_BYTES_OR_ID_MISMATCH');
    if(encrypted.length<=HEADER+TAG||!encrypted.subarray(0,8).equals(MAGIC)||
       encrypted.subarray(8,44).toString('ascii')!==evidence.identity.installation_id||
       encrypted.subarray(44,80).toString('ascii')!==bid)throw Error('ENCRYPTED_HEADER_ID_MISMATCH');
    try{
      const decipher=createDecipheriv('aes-256-gcm',secret,encrypted.subarray(80,92),{authTagLength:TAG});
      decipher.setAAD(encrypted.subarray(0,HEADER));
      decipher.setAuthTag(encrypted.subarray(-TAG));
      partial=decipher.update(encrypted.subarray(HEADER,-TAG));
      last=decipher.final();
      plain=Buffer.concat([partial,last]);
    }catch{throw Error('BACKUP_AEAD_AUTHENTICATION_FAILED')}
    // NO plaintext is written before both independent manifest signature
    // and the GCM tag have been verified. Do not execute recovered data.
    await publish(record,outputName,plain);
    return Object.freeze({encryption_verified:true,authenticated_manifest:true,
      recovered_to_private_staging:true,mutation_authorized:false,restore_authorized:false});
  }finally{
    secret.fill(0);
    if(partial)partial.fill(0);if(last)last.fill(0);if(plain)plain.fill(0);
  }
}
