// Reference POSIX storage adapter. No runtime integration or Windows ACL
// claim. Caller must hold the trusted installer lock and verify observed
// service/database/credential state. Never create or replace a live DB.
import { constants } from 'node:fs';
import { lstat, realpath, open, link, unlink, readdir } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
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
async function readAt(directory,withDigest=false){
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
      const identity=validateInstallationIdentity(JSON.parse(source));
      return withDigest?Object.freeze({identity,sha256:createHash('sha256').update(bytes.subarray(0,n)).digest('hex')}):identity;
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

// Dedicated setup metadata entrypoints. Caller observations remain planning
// inputs, not proof of runtime absence. The CLI holds a cooperative lock.
function receipt(record,created){
  return Object.freeze({schema_version:1,installation_id:record.identity.installation_id,
    identity_sha256:record.sha256,identity_created:created,local_identity_verified:true,
    database_binding_verified:false,existing_installation_reconciled:false,
    restore_authorized:false,installation_authorized:false,production_accepted:false});
}
async function readDedicated(record){
  const names=await readdir(record.full);
  if(names.length!==1||names[0]!==FILE)fail('IDENTITY_DIRECTORY_RECONCILIATION_REQUIRED');
  const result=await readAt(record,true);
  const after=await readdir(record.full);
  if(!result||after.length!==1||after[0]!==FILE)fail('IDENTITY_DIRECTORY_RECONCILIATION_REQUIRED');
  await assertDirectory(record);return result;
}
export async function initializeLocalInstallationIdentity({confirmation,directoryPath,observed}={}){
  if(confirmation!=='INITIALIZE_EMPTY_IDENTITY_STORE_ONLY')fail('EXPLICIT_IDENTITY_INITIALIZATION_REQUIRED');
  const plan=planInstallationIdentity({intent:'fresh',observed});
  if(plan.reason!=='GENERATE_NEW_IDENTITY')fail(plan.reason);
  const snapshot={database:observed.database,credentials:observed.credentials,service:observed.service};
  const record=await privateDirectory(directoryPath);
  if((await readdir(record.full)).length)fail('IDENTITY_DIRECTORY_NOT_EMPTY');
  const identity=await initializeFreshInstallationIdentity(record.full,snapshot);
  const stored=await readDedicated(record);
  if(stored.identity.installation_id!==identity.installation_id)fail('IDENTITY_FILE_CHANGED');
  return receipt(stored,true);
}
export async function inspectLocalInstallationIdentity({confirmation,directoryPath,expectedInstallationId,expectedIdentitySha256}={}){
  if(confirmation!=='INSPECT_PINNED_IDENTITY_STORE_ONLY'||typeof expectedIdentitySha256!=='string'||
    expectedIdentitySha256.length!==64||!/^[a-f0-9]{64}$/.test(expectedIdentitySha256)||/^0+$/.test(expectedIdentitySha256))
    fail('EXPLICIT_PINNED_IDENTITY_REQUIRED');
  const expected=validateInstallationIdentity({schema_version:1,installation_id:expectedInstallationId});
  const record=await privateDirectory(directoryPath),stored=await readDedicated(record);
  if(stored.sha256!==expectedIdentitySha256||stored.identity.installation_id!==expected.installation_id)fail('IDENTITY_PIN_MISMATCH');
  return receipt(stored,false);
}
