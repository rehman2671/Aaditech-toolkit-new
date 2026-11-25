// Reference POSIX storage adapter. No runtime integration or Windows ACL
// claim. Caller must hold the trusted installer lock and verify observed
// service/database/credential state. Never create or replace a live DB.
import { constants } from 'node:fs';
import { lstat, realpath, open, link, unlink } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { planInstallationIdentity, validateInstallationIdentity } from './installation-identity.mjs';
import { rejectDuplicateJsonKeys } from './verify-lan-bundle.mjs';

const FILE = 'installation-identity.json';
const fail=code=>{throw Error(code)};
const same=(a,b,fields)=>fields.every(k=>a[k]===b[k]);
const dirFields=['dev','ino','uid','mode'];
const fileFields=[...dirFields,'nlink','size','ctimeMs','mtimeMs'];
const validFile=s=>s.isFile()&&s.uid===process.geteuid()&&(s.mode&0o7777)===0o600&&s.nlink===1&&s.size>=1&&s.size<=1024;
async function privateDirectory(directory) {
  if (typeof process.geteuid !== 'function' || !constants.O_NOFOLLOW) fail('POSIX_PRIVATE_STORAGE_REQUIRED');
  if(typeof directory!=='string'||directory.length>4096||!isAbsolute(directory)||
     /[\x00-\x1f\x7f]/.test(directory)||resolve(directory)!==directory)fail('IDENTITY_DIRECTORY_NOT_PRIVATE');
  const st = await lstat(directory);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.geteuid() ||
      (st.mode & 0o7777) !== 0o700 || await realpath(directory) !== directory) {
    fail('IDENTITY_DIRECTORY_NOT_PRIVATE');
  }
  return {full:directory,stat:st};
}
async function assertDirectory(record){
  const current=await privateDirectory(record.full);
  if(!same(current.stat,record.stat,dirFields))fail('IDENTITY_DIRECTORY_CHANGED');
}
async function readAt(directory){
  const file=join(directory.full,FILE);
  let st;
  try{st=await lstat(file)}catch(e){
    if(e.code!=='ENOENT')throw e;
    await assertDirectory(directory);
    // A second observation prevents treating an already replaced leaf as absent.
    try{await lstat(file)}catch(err){if(err.code==='ENOENT')return null;throw err}
    fail('IDENTITY_FILE_CHANGED');
  }
  if(!validFile(st)||await realpath(file)!==file)fail('IDENTITY_FILE_NOT_PRIVATE_OR_VALID');
  const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    if(!same(st,await fd.stat(),fileFields))fail('IDENTITY_FILE_CHANGED');
    const bytes=Buffer.alloc(st.size+1);let n=0;
    while(n<bytes.length){
      const {bytesRead}=await fd.read(bytes,n,bytes.length-n,n);
      if(!bytesRead)break;n+=bytesRead;
    }
    if(n!==st.size||!same(st,await fd.stat(),fileFields)||
       !same(st,await lstat(file),fileFields))fail('IDENTITY_FILE_CHANGED');
    await assertDirectory(directory);
    if(!same(st,await lstat(file),fileFields))fail('IDENTITY_FILE_CHANGED');
    try{
      if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)fail('INVALID_INSTALLATION_IDENTITY');
      const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n));
      rejectDuplicateJsonKeys(source);
      return validateInstallationIdentity(JSON.parse(source));
    }catch{fail('INVALID_INSTALLATION_IDENTITY')}
  }finally{await fd.close()}
}
export async function readInstallationIdentity(directory) {
  return readAt(await privateDirectory(directory));
}
export async function initializeFreshInstallationIdentity(directory, observed) {
  // Validate caller observations before any await. Never use a mutable
  // observation record later to turn a blocked fresh request into a write.
  const initial=planInstallationIdentity({intent:'fresh',observed});
  if(initial.reason!=='GENERATE_NEW_IDENTITY')fail(initial.reason);
  const record=await privateDirectory(directory),full=record.full;
  if(await readAt(record)!==null)fail('FRESH_REQUIRES_EMPTY_TARGET');
  const identity = validateInstallationIdentity({schema_version:1, installation_id:randomUUID()});
  const tmp = join(full, '.identity-' + randomUUID() + '.tmp');
  let fd,created=false;
  try {
    await assertDirectory(record);
    fd = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created=true;
    await fd.chmod(0o600);
    await fd.writeFile(JSON.stringify(identity) + '\n', 'utf8');
    await fd.sync();
    await fd.close(); fd = undefined;
    await assertDirectory(record);
    // Atomic no-replacement publication. No rename-overwrite or rotation.
    await link(tmp, join(full, FILE));
  } finally {
    if (fd) await fd.close();
    if(created){
      await assertDirectory(record);
      await unlink(tmp);
    }
  }
  await assertDirectory(record);
  const dirfd = await open(full, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if(!same(record.stat,await dirfd.stat(),dirFields))fail('IDENTITY_DIRECTORY_CHANGED');
    await dirfd.sync();
  } finally { await dirfd.close(); }
  const stored=await readAt(record);
  if(!stored||stored.installation_id!==identity.installation_id)fail('IDENTITY_FILE_CHANGED');
  return stored;
}
