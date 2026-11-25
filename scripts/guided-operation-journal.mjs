// Read-only diagnosis for the actual guided private stack operation journal.
// This is NOT the older independently signed checkpoint protocol. Even an
// independently pinned head is only an exact history observation, never proof
// of resource readiness, writer quiescence, rollback safety or resume authority.
import {constants} from 'node:fs';
import {lstat,realpath,open,readdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const fail=()=>{throw Error('GUIDED_OPERATION_JOURNAL_UNCONFIRMED')};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x);
const nonzero=x=>hex(x)&&!/^0+$/.test(x);
const zero='0'.repeat(64);
const projectOk=x=>typeof x==='string'&&x.length<=48&&/^[a-z0-9][a-z0-9_-]*$(?![\s\S])/.test(x);
const pathOk=x=>typeof x==='string'&&x.length>1&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f,]/.test(x);
const nested=(a,b)=>{const q=relative(a,b);return q===''||!isAbsolute(q)&&q!=='..'&&!q.startsWith('../')};
const sha=x=>createHash('sha256').update(x).digest('hex');
export const guidedPrivateStackSteps=Object.freeze(['PREFLIGHT','IDENTITY','CONFIGURATION','TLS_MATERIAL','RESOURCES','STOPPED_CANDIDATES','PRIVATE_STACK']);
const max=guidedPrivateStackSteps.length*2;
const eventName=i=>'event-'+String(i).padStart(3,'0')+'.json';
const keys=['schema_version','sequence','project','release_sha256','step','event','previous_sha256','evidence_sha256'];
export function guidedStartedDigest(step,releaseSha256){
 if(!guidedPrivateStackSteps.includes(step)||!nonzero(releaseSha256))fail();
 return sha(Buffer.from(step+':'+releaseSha256));
}
export function encodeGuidedOperationEvent(r){
 if(!exact(r,keys)||r.schema_version!==1||!Number.isSafeInteger(r.sequence)||r.sequence<1||r.sequence>max||!projectOk(r.project)||!nonzero(r.release_sha256)||!hex(r.previous_sha256)||!nonzero(r.evidence_sha256))fail();
 const step=guidedPrivateStackSteps[Math.floor((r.sequence-1)/2)],event=r.sequence%2===1?'STARTED':'COMPLETED';
 if(r.step!==step||r.event!==event||(r.sequence===1?r.previous_sha256!==zero:!nonzero(r.previous_sha256))||event==='STARTED'&&r.evidence_sha256!==guidedStartedDigest(step,r.release_sha256))fail();
 return Buffer.from(JSON.stringify({schema_version:1,sequence:r.sequence,project:r.project,release_sha256:r.release_sha256,step:r.step,event:r.event,previous_sha256:r.previous_sha256,evidence_sha256:r.evidence_sha256})+'\n');
}
export function validateGuidedJournalPolicy(input){
 if(!exact(input,['confirmation','project','releaseSha256','journalDirectory','operationLockRoot','adapterLockRoot','expectedHead'])||input.confirmation!=='INSPECT_GUIDED_OPERATION_HISTORY_ONLY'||!projectOk(input.project)||!nonzero(input.releaseSha256))fail();
 const dirs=[input.journalDirectory,input.operationLockRoot,input.adapterLockRoot];
 if(!dirs.every(pathOk)||dirs.some((a,i)=>dirs.some((b,j)=>i!==j&&nested(a,b))))fail();
 const h=input.expectedHead;
 if(h!==null&&(!exact(h,['sequence','sha256'])||!Number.isSafeInteger(h.sequence)||h.sequence<0||h.sequence>max||!hex(h.sha256)||(h.sequence===0?h.sha256!==zero:!nonzero(h.sha256))))fail();
 return Object.freeze({...input,expectedHead:h===null?null:Object.freeze({...h})});
}
export function inspectGuidedEventChain(records,project,releaseSha256,expectedHead=null){
 if(!projectOk(project)||!nonzero(releaseSha256)||!Array.isArray(records)||records.length>max)fail();
 let previous=zero;
 for(let i=0;i<records.length;i++){
  const bytes=records[i];
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>4096)fail();
  let r;
  try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(raw);r=JSON.parse(raw)}catch{fail()}
  if(!bytes.equals(encodeGuidedOperationEvent(r))||r.sequence!==i+1||r.project!==project||r.release_sha256!==releaseSha256||r.previous_sha256!==previous)fail();
  previous=sha(bytes);
 }
 if(expectedHead!==null&&(!exact(expectedHead,['sequence','sha256'])||expectedHead.sequence!==records.length||expectedHead.sha256!==previous))fail();
 const completed=Math.floor(records.length/2),pending=records.length%2===1?guidedPrivateStackSteps[completed]:null;
 return Object.freeze({sequence:records.length,head_sha256:previous,completed,pending,independent_head_matched:expectedHead!==null});
}
const dirFields=['dev','ino','uid','gid','mode','mtimeMs','ctimeMs'],fileFields=[...dirFields,'nlink','size'];
const same=(a,b,keys)=>keys.every(k=>a[k]===b[k]);
async function directory(path){
 const s=await lstat(path);
 if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(path)!==path)fail();
 return s;
}
async function readPrivate(path,maxBytes){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const s=await fd.stat();
  if(!s.isFile()||s.uid!==process.geteuid()||s.nlink!==1||(s.mode&0o7777)!==0o600||s.size<1||s.size>maxBytes)fail();
  const bytes=Buffer.alloc(s.size+1);let n=0;
  while(n<bytes.length){const r=await fd.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==s.size||!same(s,await fd.stat(),fileFields)||!same(s,await lstat(path),fileFields))fail();
  return {bytes:bytes.subarray(0,n),stat:s};
 }finally{await fd.close()}
}
async function names(path){const result=(await readdir(path)).sort();if(result.length>max)fail();return result}
async function lockSnapshot(root){
 const before=await directory(root),entries=await names(root);
 let status='EMPTY',child=null,owner=null;
 if(entries.length){
  // An incomplete lock is never treated as free. Unknown entries and
  // malformed metadata require reconciliation, not guessed PID liveness.
  if(entries.length!==1||entries[0]!=='setup.lock')fail();
  const path=join(root,'setup.lock'),s=await directory(path),inside=await names(path);
  status='RETAINED_OR_ACTIVE';
  if(inside.length===0)status='INCOMPLETE_LOCK';
  else{
   if(inside.length!==1||inside[0]!=='owner.json')fail();
   owner=await readPrivate(join(path,'owner.json'),1024);
   let value;
   try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(owner.bytes);rejectDuplicateJsonKeys(raw);value=JSON.parse(raw)}catch{fail()}
   if(!exact(value,['schema_version','lock_id'])||value.schema_version!==1||typeof value.lock_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$(?![\s\S])/.test(value.lock_id)||!owner.bytes.equals(Buffer.from(JSON.stringify({schema_version:1,lock_id:value.lock_id})+'\n')))fail();
  }
  if(!same(s,await directory(path),dirFields))fail();
  child=s;
 }
 if(!same(before,await directory(root),dirFields))fail();
 return {status,before,child,owner};
}
function sameLock(a,b){
 return a.status===b.status&&same(a.before,b.before,dirFields)&&!!a.child===!!b.child&&(!a.child||same(a.child,b.child,dirFields))&&!!a.owner===!!b.owner&&(!a.owner||same(a.owner.stat,b.owner.stat,fileFields)&&a.owner.bytes.equals(b.owner.bytes));
}
export async function inspectGuidedOperationJournal(input){
 const p=validateGuidedJournalPolicy(input);
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||!constants.O_NOFOLLOW)fail();
 const dir=await directory(p.journalDirectory),operation=await lockSnapshot(p.operationLockRoot),adapter=await lockSnapshot(p.adapterLockRoot),entries=await names(p.journalDirectory);
 if(entries.some((n,i)=>n!==eventName(i+1)))fail();
 const records=[];
 for(const name of entries)records.push(await readPrivate(join(p.journalDirectory,name),4096));
 const state=inspectGuidedEventChain(records.map(x=>x.bytes),p.project,p.releaseSha256,p.expectedHead);
 for(let i=0;i<entries.length;i++){
  const now=await readPrivate(join(p.journalDirectory,entries[i]),4096),old=records[i];
  if(!same(now.stat,old.stat,fileFields)||!now.bytes.equals(old.bytes))fail();
 }
 if(JSON.stringify(await names(p.journalDirectory))!==JSON.stringify(entries)||!same(dir,await directory(p.journalDirectory),dirFields)||!sameLock(operation,await lockSnapshot(p.operationLockRoot))||!sameLock(adapter,await lockSnapshot(p.adapterLockRoot)))fail();
 const locked=operation.status!=='EMPTY'||adapter.status!=='EMPTY';
 const decision=locked||state.pending?'OPERATOR_RECONCILIATION_REQUIRED':state.sequence===0?'NO_OPERATION_RECORDED':state.completed===guidedPrivateStackSteps.length?'RECORDED_COMPLETE_REVALIDATE_ACTUAL_STACK':'PARTIAL_HISTORY_RECONCILIATION_REQUIRED';
 return Object.freeze({schema_version:1,decision,sequence:state.sequence,head_sha256:state.head_sha256,independent_head_matched:state.independent_head_matched,operation_lock_state:operation.status,adapter_lock_state:adapter.status,steps:Object.freeze(guidedPrivateStackSteps.map((step,i)=>Object.freeze({step,status:i<state.completed?'RECORDED_COMPLETE':step===state.pending?'RECONCILIATION_REQUIRED':'NOT_RECORDED'}))),next_recorded_step:state.pending??guidedPrivateStackSteps[state.completed]??null,actual_resources_verified:false,writer_quiescence_verified:false,resume_authorized:false,rollback_authorized:false,execution_authorized:false,production_accepted:false});
}
