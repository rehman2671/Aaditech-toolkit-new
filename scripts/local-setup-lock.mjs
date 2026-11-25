// Cooperative local setup lock for reviewed code only. No PID-based takeover,
// timeout, external command adapter or automatic stale-lock removal.
import {constants} from 'node:fs';
import {lstat,realpath,readdir,mkdir,open,unlink,rmdir} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const fail=code=>{throw Error(code)};
const fingerprint=s=>['dev','ino','uid','mode'].map(k=>s[k]);
const equal=(a,b)=>a.every((x,i)=>x===b[i]);
async function privateDir(path,expected){
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||!constants.O_NOFOLLOW||
    typeof path!=='string'||path.length>4096||!isAbsolute(path)||resolve(path)!==path||path.includes('\0'))fail('PRIVATE_SETUP_LOCK_ROOT_REQUIRED');
 const s=await lstat(path);
 if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||
    await realpath(path)!==path||(expected&&!equal(fingerprint(s),expected)))fail('PRIVATE_SETUP_LOCK_ROOT_REQUIRED');
 return fingerprint(s);
}
async function syncDir(path,expected){
 const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{if(!equal(fingerprint(await fd.stat()),expected))fail('SETUP_LOCK_CHANGED');await fd.sync()}finally{await fd.close()}
}
export async function withLocalSetupLock({confirmation,lockRoot}={},operation){
 if(confirmation!=='ACQUIRE_LOCAL_SETUP_LOCK_ONLY'||typeof operation!=='function')fail('EXPLICIT_SETUP_LOCK_REQUIRED');
 const parent=await privateDir(lockRoot),lock=join(lockRoot,'setup.lock'),marker=join(lock,'owner.json');
 const before=await readdir(lockRoot);
 if(before.length)fail('SETUP_LOCK_RECONCILIATION_REQUIRED');
 try{await mkdir(lock,{mode:0o700})}catch(e){if(e.code==='EEXIST')fail('SETUP_LOCK_RECONCILIATION_REQUIRED');throw e}
 // After mkdir, any failure leaves the lock for manual review, including
 // failure before the owner marker is durable. Never steal another lock.
 const identity=await privateDir(lock);
 const bytes=Buffer.from(JSON.stringify({schema_version:1,lock_id:randomUUID()})+'\n');
 const fd=await open(marker,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 let markerStat;
 try{await fd.chmod(0o600);await fd.writeFile(bytes);await fd.sync();markerStat=await fd.stat()}finally{await fd.close()}
 await syncDir(lock,identity);await syncDir(lockRoot,parent);
 async function assertHeld(){
  await privateDir(lockRoot,parent);await privateDir(lock,identity);
  const names=await readdir(lock);
  if(names.length!==1||names[0]!=='owner.json')fail('SETUP_LOCK_CHANGED');
  const f=await open(marker,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const st=await f.stat();
   if(!st.isFile()||st.nlink!==1||st.size!==bytes.length||!equal(fingerprint(st),fingerprint(markerStat))||
      st.mtimeMs!==markerStat.mtimeMs||st.ctimeMs!==markerStat.ctimeMs)fail('SETUP_LOCK_CHANGED');
   const read=Buffer.alloc(bytes.length+1);let n=0;
   while(n<read.length){const r=await f.read(read,n,read.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
   if(n!==bytes.length||!read.subarray(0,n).equals(bytes))fail('SETUP_LOCK_CHANGED');
   const current=await lstat(marker);
   if(!equal(fingerprint(current),fingerprint(st))||current.nlink!==1||current.size!==st.size||
      current.mtimeMs!==st.mtimeMs||current.ctimeMs!==st.ctimeMs)fail('SETUP_LOCK_CHANGED');
  }finally{await f.close()}
 }
 await assertHeld();
 const result=await operation(Object.freeze({lock_sha256:createHash('sha256').update(bytes).digest('hex')}));
 await assertHeld();
 // No callback or other writer may alter this dedicated directory.
 await unlink(marker);await syncDir(lock,identity);
 await rmdir(lock);await syncDir(lockRoot,parent);
 return result;
}
