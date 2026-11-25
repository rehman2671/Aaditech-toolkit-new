// Local file activation only. The deployment operator must stop dependent
// services and prove TLS/DB continuity separately. Never invoke a service,
// Docker daemon, shell, or browser-supplied activation.
import {constants} from 'node:fs';
import {open,lstat,realpath,link,unlink,rename,readdir} from 'node:fs/promises';
import {resolve,dirname,basename,join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {patchRuntimeEnvironment} from './prepare-runtime-configuration.mjs';
const fail=()=>{throw Error('RUNTIME_CONFIGURATION_SWITCH_REFUSED')};
const sha=b=>createHash('sha256').update(b).digest('hex');
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const pathOk=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const own=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const same=(a,b,keys=['dev','ino','uid','mode','size','mtimeMs','ctimeMs','nlink'])=>keys.every(k=>a[k]===b[k]);
const dirKeys=['dev','ino','uid','mode'];
async function privateDir(path,expected){
 const st=await lstat(path);
 if(!st.isDirectory()||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o700||await realpath(path)!==path||(expected&&!same(st,expected,dirKeys)))fail();
 return st;
}
async function pinned(path,expected){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o600||st.nlink!==1||st.size<1||st.size>262144)fail();
  const bytes=Buffer.alloc(st.size+1);let offset=0;
  while(offset<bytes.length){const r=await fd.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)break;offset+=r.bytesRead}
  const body=bytes.subarray(0,offset);
  if(offset!==st.size||sha(body)!==expected||!same(st,await fd.stat())||!same(st,await lstat(path)))fail();
  return {bytes:body,st};
 }finally{await fd.close()}
}
async function syncDir(path,st){
 const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{if(!same(await f.stat(),st,dirKeys))fail();await f.sync()}finally{await f.close()}
}
async function publishCopy(parent,dest,bytes,st){
 const tmp=join(parent,'.env.switch-'+randomUUID());let created=false;
 try{
  const f=await open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;
  try{await f.chmod(0o600);await f.writeFile(bytes);await f.sync()}finally{await f.close()}
  await privateDir(parent,st);await link(tmp,dest);
 }finally{if(created)await unlink(tmp)}
 await syncDir(parent,st);
}
async function validateCandidate(old,next,profile,changes){
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(old)}catch{fail()}
 if(!Buffer.from(text).equals(old)||!Buffer.from(patchRuntimeEnvironment(text,profile,changes).text).equals(next))fail();
}
export async function switchRuntimeConfiguration(input){
 const common=['confirmation','operation','profile','activePath','lockRoot','originalSha256','candidateSha256','changes'];
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||!own(input,common)||!['activate','rollback'].includes(input.operation)||input.confirmation!==(input.operation==='activate'?'SWITCH_CONFIGURATION_FILE_ONLY_SERVICES_QUIESCED':'RESTORE_CONFIGURATION_FILE_ONLY_SERVICES_QUIESCED')||!pathOk(input.activePath)||basename(input.activePath)!=='.env'||!pathOk(input.lockRoot)||!digest(input.originalSha256)||!digest(input.candidateSha256)||input.originalSha256===input.candidateSha256)fail();
 const {operation,profile,activePath,lockRoot,originalSha256,candidateSha256,changes}=input,parent=dirname(activePath);
 const candidate=join(parent,'.env.candidate'),backup=join(parent,'.env.previous-'+originalSha256),replacement=join(parent,'.env.switch-ready-'+randomUUID());
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot},async()=>{
  const dir=await privateDir(parent);
  const current=await pinned(activePath,operation==='activate'?originalSha256:candidateSha256);
  const original=operation==='activate'?current:await pinned(backup,originalSha256);
  const next=await pinned(candidate,candidateSha256);
  await validateCandidate(original.bytes,next.bytes,profile,changes);
  if(operation==='activate'){
   // Durable no-overwrite recovery copy before active name changes.
   await publishCopy(parent,backup,original.bytes,dir);
   await pinned(backup,originalSha256);
  }
  const target=operation==='activate'?next:original,expected=operation==='activate'?candidateSha256:originalSha256;
  await publishCopy(parent,replacement,target.bytes,dir);
  await pinned(replacement,expected);
  await privateDir(parent,dir);
  if(!same(current.st,await lstat(activePath)))fail();
  // Atomic same-directory replacement under exclusive cooperative custody.
  await rename(replacement,activePath);
  await syncDir(parent,dir);
  await pinned(activePath,expected);
  await pinned(backup,originalSha256);
  return {operation,active_sha256:expected,recovery_sha256:originalSha256,configuration_file_changed:true,
   services_quiescence_operator_asserted:true,service_restart_performed:false,tls_verified:false,database_continuity_verified:false,production_accepted:false};
 });
}

// Read-only reconciliation after an interrupted file switch. A cooperative
// lock or staging file is never removed or taken over by this inspector.
export async function inspectRuntimeConfigurationRecovery(input){
 const keys=['confirmation','profile','activePath','lockRoot','originalSha256','candidateSha256','changes'];
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||!own(input,keys)||input.confirmation!=='INSPECT_RUNTIME_CONFIGURATION_RECOVERY_ONLY'||!pathOk(input.activePath)||basename(input.activePath)!=='.env'||!pathOk(input.lockRoot)||!digest(input.originalSha256)||!digest(input.candidateSha256)||input.originalSha256===input.candidateSha256)fail();
 const {activePath,lockRoot,originalSha256,candidateSha256,profile,changes}=input,parent=dirname(activePath);
 const dir=await privateDir(parent),lock=await privateDir(lockRoot);
 const candidate=join(parent,'.env.candidate'),backup=join(parent,'.env.previous-'+originalSha256);
 async function observe(path,pins){
  try{await lstat(path)}catch(e){if(e.code==='ENOENT')return {state:'ABSENT'};throw e}
  for(const [state,digest] of pins){try{const p=await pinned(path,digest);return {state,bytes:p.bytes,st:p.st}}catch{}}
  return {state:'UNVERIFIED'};
 }
 const a=await observe(activePath,[['ORIGINAL',originalSha256],['CANDIDATE',candidateSha256]]);
 const c=await observe(candidate,[['MATCHED',candidateSha256]]);
 const b=await observe(backup,[['MATCHED',originalSha256]]);
 const before=await readdir(parent),locks=await readdir(lockRoot);
 if(before.length>10000||locks.length>100)fail();
 const leftovers=before.filter(x=>x.startsWith('.env.switch-')||x.startsWith('.env.candidate-')).length;
 let candidatePolicyVerified=false;
 const original=a.state==='ORIGINAL'?a:b.state==='MATCHED'?b:null;
 if(original&&c.state==='MATCHED')try{await validateCandidate(original.bytes,c.bytes,profile,changes);candidatePolicyVerified=true}catch{}
 let state='MANUAL_RECONCILIATION_REQUIRED';
 if(!locks.length&&!leftovers&&candidatePolicyVerified){
  if(a.state==='ORIGINAL'&&b.state==='ABSENT')state='PREPARED_NOT_SWITCHED';
  else if(a.state==='CANDIDATE'&&b.state==='MATCHED')state='CANDIDATE_ACTIVE_BACKUP_MATCHED';
  else if(a.state==='ORIGINAL'&&b.state==='MATCHED')state='ORIGINAL_ACTIVE_BACKUP_MATCHED';
 }
 await privateDir(parent,dir);await privateDir(lockRoot,lock);
 if(JSON.stringify((await readdir(parent)).sort())!==JSON.stringify(before.sort())||JSON.stringify((await readdir(lockRoot)).sort())!==JSON.stringify(locks.sort()))fail();
 for(const [p,o] of [[activePath,a],[candidate,c],[backup,b]]){
  if(o.st&&!same(o.st,await lstat(p)))fail();
  if(o.state==='ABSENT'){try{await lstat(p);fail()}catch(e){if(e.code!=='ENOENT')throw e}}
 }
 return {state,active_state:a.state,candidate_state:c.state,backup_state:b.state,candidate_policy_verified:candidatePolicyVerified,lock_entries_present:locks.length>0,staging_files_present:leftovers>0,
  files_changed:false,lock_removed:false,services_quiescence_verified:false,service_restart_authorized:false,production_accepted:false};
}
