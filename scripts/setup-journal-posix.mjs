// Durable POSIX reference setup journal. Not a runtime mutation adapter.
// One append-only record per event, no automatic stale lock removal/replay.
// Trusted owner-only directory and ancestors, exclusive caller orchestration.
import {constants} from 'node:fs';
import {open,lstat,realpath,readdir,link,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateInstallationIdentity} from './installation-identity.mjs';
const STEPS=['PREFLIGHT','TRUST','DATABASE','API','ADMIN','AGENT'];
const HEX=/^[a-f0-9]{64}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
const uuid=s=>validateInstallationIdentity({schema_version:1,installation_id:s}).installation_id;
const hex=s=>typeof s==='string'&&s.length===64&&HEX.test(s);
const fail=s=>{throw Error(s)};
const recordName=i=>'event-'+String(i).padStart(3,'0')+'.json';
const MAX=STEPS.length*2;
async function privateDir(dir){
 if(typeof process.geteuid!=='function'||!constants.O_NOFOLLOW)fail('POSIX_PRIVATE_STORAGE_REQUIRED');
 const p=resolve(dir),s=await lstat(p);
 if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o777)!==0o700||await realpath(p)!==p)fail('PRIVATE_JOURNAL_REQUIRED');
 return p;
}
async function readRecord(dir,name){
 const fd=await open(join(dir,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||st.uid!==process.geteuid()||(st.mode&0o777)!==0o600||st.size<1||st.size>2048)fail('INVALID_JOURNAL_FILE');
  const b=Buffer.alloc(st.size+1);let n=0;
  while(n<b.length){const {bytesRead}=await fd.read(b,n,b.length-n,n);if(!bytesRead)break;n+=bytesRead}
  if(n!==st.size)fail('JOURNAL_CHANGED');
  const after=await fd.stat(),cur=await lstat(join(dir,name));
  if([after,cur].some(x=>!x.isFile()||x.nlink!==1||['dev','ino','size','mtimeMs','ctimeMs','mode','uid'].some(k=>x[k]!==st[k])))fail('JOURNAL_CHANGED');
  return b.subarray(0,n);
 }finally{await fd.close()}
}
function encode(r){return Buffer.from(JSON.stringify({
 schema_version:1,sequence:r.sequence,installation_id:r.installation_id,
 release_sha256:r.release_sha256,previous_sha256:r.previous_sha256,
 step:r.step,event:r.event,evidence_sha256:r.evidence_sha256
})+'\n')}
function binding(installationId,releaseSha256){
 if(!hex(releaseSha256))fail('RELEASE_DIGEST_REQUIRED');
 return {installation_id:uuid(installationId),release_sha256:releaseSha256};
}
async function scan(dir,b){
 // Dedicated journal directory only. Unexpected orphan temp file, lock,
 // gaps or truncated record means manual review, never "start fresh".
 const names=(await readdir(dir)).sort();
 if(names.length>MAX||names.some((n,i)=>n!==recordName(i+1)))fail('JOURNAL_INCOMPLETE_OR_UNEXPECTED');
 let prev='0'.repeat(64),pending=null,completed=0;
 for(let i=0;i<names.length;i++){
  const bytes=await readRecord(dir,names[i]),r=JSON.parse(bytes.toString('utf8'));
  if(!r||!bytes.equals(encode(r))||r.schema_version!==1||r.sequence!==i+1||
     r.installation_id!==b.installation_id||r.release_sha256!==b.release_sha256||
     r.previous_sha256!==prev||r.step!==STEPS[completed]||!hex(r.evidence_sha256)||
     r.event!==(pending?'COMPLETED':'STARTED'))fail('JOURNAL_BINDING_OR_ORDER_INVALID');
  if(pending){pending=null;completed++}else pending=r.step;
  prev=hash(bytes);
 }
 return {sequence:names.length,previous_sha256:prev,pending,completed,
  decision:pending?'OPERATOR_RECONCILIATION_REQUIRED':'REVALIDATE_ACTUAL_EVIDENCE',
  execution_authorized:false,production_accepted:false};
}
export async function inspectSetupJournal({directory,installationId,releaseSha256}){
 const dir=await privateDir(directory);
 return Object.freeze(await scan(dir,binding(installationId,releaseSha256)));
}
export async function appendSetupJournalEvent({directory,installationId,releaseSha256,
 expectedSequence,expectedPreviousSha256,step,event,evidenceSha256}){
 const dir=await privateDir(directory),b=binding(installationId,releaseSha256);
 if(!hex(evidenceSha256)||!hex(expectedPreviousSha256))fail('EVIDENCE_DIGEST_REQUIRED');
 const state=await scan(dir,b);
 if(state.sequence!==expectedSequence||state.previous_sha256!==expectedPreviousSha256)fail('STALE_JOURNAL_STATE');
 if(state.completed>=STEPS.length||step!==STEPS[state.completed]||
    event!==(state.pending?'COMPLETED':'STARTED'))fail('JOURNAL_STEP_ORDER_INVALID');
 // Completion must be recorded only by independently verified actual
 // execution/reconciliation; this journal does not authenticate that evidence.
 const record=encode({sequence:state.sequence+1,...b,previous_sha256:state.previous_sha256,
   step,event,evidence_sha256:evidenceSha256});
 const temp=join(dir,'.journal-'+randomUUID()+'.tmp');
 let fd,created=false;
 try{
  fd=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  created=true;await fd.chmod(0o600);await fd.writeFile(record);await fd.sync();await fd.close();fd=null;
  await link(temp,join(dir,recordName(state.sequence+1)));
 }finally{if(fd)await fd.close();if(created)await unlink(temp)}
 const d=await open(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await d.sync()}finally{await d.close()}
 return Object.freeze({recorded:true,sequence:state.sequence+1,record_sha256:hash(record),
   execution_authorized:false,production_accepted:false});
}
