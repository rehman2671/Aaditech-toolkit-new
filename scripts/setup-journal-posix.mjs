// Durable POSIX reference setup journal. Not a runtime mutation adapter.
// One append-only record per event, no automatic stale lock removal/replay.
// Trusted owner-only directory and ancestors, exclusive caller orchestration.
import {constants} from 'node:fs';
import {open,lstat,realpath,opendir,link,unlink} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {createHash,randomUUID,createPublicKey,verify} from 'node:crypto';
import {validateInstallationIdentity} from './installation-identity.mjs';
const STEPS=['PREFLIGHT','TRUST','DATABASE','API','ADMIN','AGENT'];
const HEX=/^[a-f0-9]{64}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
const uuid=s=>validateInstallationIdentity({schema_version:1,installation_id:s}).installation_id;
const hex=s=>typeof s==='string'&&s.length===64&&HEX.test(s);
const fail=s=>{throw Error(s)};
const recordName=i=>'event-'+String(i).padStart(3,'0')+'.json';
const MAX=STEPS.length*2;
const nonzeroHex=s=>hex(s)&&s!=='0'.repeat(64);
const dirFields=['dev','ino','uid','mode'];
const recordFields=[...dirFields,'nlink','size','mtimeMs','ctimeMs'];
const same=(a,b,fields)=>fields.every(k=>a[k]===b[k]);
const singlePublicPem=p=>typeof p==='string'&&p.length<=4096&&
 /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?(?![\s\S])/.test(p);
function pinnedKey(pem,code){
 try{return createPublicKey(pem)}catch{fail(code)}
}
async function privateDir(dir){
 if(typeof process.geteuid!=='function'||!constants.O_NOFOLLOW)fail('POSIX_PRIVATE_STORAGE_REQUIRED');
 if(typeof dir!=='string'||dir.length>4096||!isAbsolute(dir)||resolve(dir)!==dir||
    /[\x00-\x1f\x7f]/.test(dir))fail('PRIVATE_JOURNAL_REQUIRED');
 const s=await lstat(dir);
 if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(dir)!==dir)fail('PRIVATE_JOURNAL_REQUIRED');
 return {path:dir,stat:s};
}
async function assertDir(dir){
 const now=await privateDir(dir.path);
 if(!same(dir.stat,now.stat,dirFields))fail('JOURNAL_DIRECTORY_CHANGED');
 return now.stat;
}
async function syncDir(dir){
 await assertDir(dir);
 const d=await open(dir.path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{if(!same(dir.stat,await d.stat(),dirFields))fail('JOURNAL_DIRECTORY_CHANGED');await d.sync()}finally{await d.close()}
}
async function readRecord(dir,name){
 const path=join(dir.path,name),before=await lstat(path);
 if(!before.isFile()||before.nlink!==1||await realpath(path)!==path)fail('INVALID_JOURNAL_FILE');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o600||st.size<1||st.size>2048||!same(st,before,recordFields))fail('INVALID_JOURNAL_FILE');
  const b=Buffer.alloc(st.size+1);let n=0;
  while(n<b.length){const {bytesRead}=await fd.read(b,n,b.length-n,n);if(!bytesRead)break;n+=bytesRead}
  if(n!==st.size)fail('JOURNAL_CHANGED');
  const after=await fd.stat(),cur=await lstat(path);
  if([after,cur].some(x=>!x.isFile()||x.nlink!==1||!same(x,st,recordFields)))fail('JOURNAL_CHANGED');
  return {bytes:b.subarray(0,n),stat:st};
 }finally{await fd.close()}
}
function encode(r){return Buffer.from(JSON.stringify({
 schema_version:1,sequence:r.sequence,installation_id:r.installation_id,
 release_sha256:r.release_sha256,previous_sha256:r.previous_sha256,
 step:r.step,event:r.event,evidence_sha256:r.evidence_sha256
})+'\n')}
function binding(installationId,releaseSha256){
 if(!nonzeroHex(releaseSha256))fail('RELEASE_DIGEST_REQUIRED');
 return {installation_id:uuid(installationId),release_sha256:releaseSha256};
}
async function scan(dir,b){
 // Dedicated journal directory only. Unexpected orphan temp file, lock,
 // gaps or truncated record means manual review, never "start fresh".
 const initial=await assertDir(dir),names=[];
 for await(const entry of await opendir(dir.path)){
  if(names.length>=MAX||!entry.isFile())fail('JOURNAL_INCOMPLETE_OR_UNEXPECTED');
  names.push(entry.name);
 }
 names.sort();
 if(names.some((n,i)=>n!==recordName(i+1)))fail('JOURNAL_INCOMPLETE_OR_UNEXPECTED');
 let prev='0'.repeat(64),pending=null,completed=0;
 const observed=[];
 for(let i=0;i<names.length;i++){
  const {bytes,stat}=await readRecord(dir,names[i]);
  observed.push({name:names[i],stat});
  let r;try{r=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{fail('JOURNAL_BINDING_OR_ORDER_INVALID')}
  if(!r||!bytes.equals(encode(r))||r.schema_version!==1||r.sequence!==i+1||
     r.installation_id!==b.installation_id||r.release_sha256!==b.release_sha256||
     r.previous_sha256!==prev||r.step!==STEPS[completed]||!nonzeroHex(r.evidence_sha256)||
     r.event!==(pending?'COMPLETED':'STARTED'))fail('JOURNAL_BINDING_OR_ORDER_INVALID');
  if(pending){pending=null;completed++}else pending=r.step;
  prev=hash(bytes);
 }
 for(const x of observed){const current=await lstat(join(dir.path,x.name));if(!same(x.stat,current,recordFields))fail('JOURNAL_CHANGED')}
 const final=await assertDir(dir);
 if(!same(initial,final,['mtimeMs','ctimeMs']))fail('JOURNAL_CHANGED');
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
 if(!nonzeroHex(evidenceSha256)||!hex(expectedPreviousSha256))fail('EVIDENCE_DIGEST_REQUIRED');
 if(!Number.isSafeInteger(expectedSequence)||expectedSequence<0||expectedSequence>MAX)fail('STALE_JOURNAL_STATE');
 const state=await scan(dir,b);
 if(state.sequence!==expectedSequence||state.previous_sha256!==expectedPreviousSha256)fail('STALE_JOURNAL_STATE');
 if(state.completed>=STEPS.length||step!==STEPS[state.completed]||
    event!==(state.pending?'COMPLETED':'STARTED'))fail('JOURNAL_STEP_ORDER_INVALID');
 // Completion must be recorded only by independently verified actual
 // execution/reconciliation; this journal does not authenticate that evidence.
 const record=encode({sequence:state.sequence+1,...b,previous_sha256:state.previous_sha256,
   step,event,evidence_sha256:evidenceSha256});
 const temp=join(dir.path,'.journal-'+randomUUID()+'.tmp');
 let fd,created=false;
 try{
  await assertDir(dir);
  fd=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  created=true;await fd.chmod(0o600);await fd.writeFile(record);await fd.sync();await fd.close();fd=null;
  await assertDir(dir);
  await link(temp,join(dir.path,recordName(state.sequence+1)));
 }finally{if(fd)await fd.close();if(created){await assertDir(dir);await unlink(temp)}}
 await syncDir(dir);
 return Object.freeze({recorded:true,sequence:state.sequence+1,record_sha256:hash(record),
   execution_authorized:false,production_accepted:false});
}

// The caller must obtain the CURRENT checkpoint digest and signer pin from
// independent trusted custody, never from the journal or its backup.
// Exact equality deliberately refuses both a truncated and an advanced head.
// This is a read-only snapshot check, not an execution lock or authorization.
export async function inspectAnchoredSetupJournal({directory,installationId,releaseSha256,
 checkpointBytes,signature,signerPublicKeyPem,expectedSignerSpkiSha256,expectedCheckpointSha256}){
 const b=binding(installationId,releaseSha256);
 if(!nonzeroHex(expectedSignerSpkiSha256)||!nonzeroHex(expectedCheckpointSha256)||
    !Buffer.isBuffer(checkpointBytes)||checkpointBytes.length<1||checkpointBytes.length>1024||
    !Buffer.isBuffer(signature)||signature.length!==64||
    !singlePublicPem(signerPublicKeyPem))fail('CHECKPOINT_TRUST_REQUIRED');
 // Copy mutable buffers before any await.
 const bytes=Buffer.from(checkpointBytes),sig=Buffer.from(signature);
 if(hash(bytes)!==expectedCheckpointSha256)fail('CHECKPOINT_DIGEST_MISMATCH');
 const key=pinnedKey(signerPublicKeyPem,'CHECKPOINT_TRUST_REQUIRED');
 if(key.asymmetricKeyType!=='ed25519'||hash(key.export({type:'spki',format:'der'}))!==expectedSignerSpkiSha256)
   fail('CHECKPOINT_SIGNER_MISMATCH');
 if(!verify(null,bytes,key,sig))fail('CHECKPOINT_SIGNATURE_INVALID');
 let c;
 try{c=JSON.parse(bytes.toString('utf8'))}catch{fail('CHECKPOINT_FORMAT_INVALID')}
 if(!c||typeof c!=='object'||Array.isArray(c)||c.schema_version!==1||
    c.installation_id!==b.installation_id||c.release_sha256!==b.release_sha256||
    !Number.isSafeInteger(c.sequence)||c.sequence<1||c.sequence>MAX||!hex(c.record_sha256)||
    c.record_sha256==='0'.repeat(64))fail('CHECKPOINT_BINDING_INVALID');
 const canonical=Buffer.from(JSON.stringify({schema_version:1,installation_id:c.installation_id,
   release_sha256:c.release_sha256,sequence:c.sequence,record_sha256:c.record_sha256})+'\n');
 if(!bytes.equals(canonical))fail('CHECKPOINT_FORMAT_INVALID');
 const state=await inspectSetupJournal({directory,installationId:b.installation_id,releaseSha256:b.release_sha256});
 if(state.sequence!==c.sequence||state.previous_sha256!==c.record_sha256)fail('CHECKPOINT_HEAD_MISMATCH');
 return Object.freeze({...state,checkpoint_verified:true,checkpoint_sha256:expectedCheckpointSha256,
   execution_authorized:false,production_accepted:false});
}

// Browser-facing projection reference. Only a freshly verified, independently
// pinned journal may yield recorded stage status. Recorded completion is NOT
// actual resource readiness; no pins, paths, IDs, or evidence hashes escape.
export async function inspectSetupProgress(anchor){
 const state=await inspectAnchoredSetupJournal(anchor);
 const steps=Object.freeze(STEPS.map((step,index)=>Object.freeze({
   step,status:index<state.completed?'RECORDED_COMPLETE':
      step===state.pending?'RECONCILIATION_REQUIRED':'NOT_RECORDED'
 })));
 return Object.freeze({steps,checkpoint_verified:true,
   next_step:state.pending??STEPS[state.completed]??null,
   decision:state.pending?'OPERATOR_RECONCILIATION_REQUIRED':'REVALIDATE_ACTUAL_EVIDENCE',
   actual_readiness_verified:false,execution_authorized:false,production_accepted:false});
}

// Handoff evidence is a short-lived signed display binding, NOT a browser
// login credential, bearer token, consumed grant or execution authorization.
// expectedChallengeSha256, expectedSessionSha256 and clock must be supplied
// by trusted local custody; never taken from the signed envelope or browser.
export async function inspectSetupHandoff({anchor,handoffBytes,signature,signerPublicKeyPem,
 expectedSignerSpkiSha256,expectedHandoffSha256,expectedChallengeSha256,expectedSessionSha256,nowMs}={}){
 const validDigest=x=>hex(x)&&x!=='0'.repeat(64);
 if(!anchor||![expectedSignerSpkiSha256,expectedHandoffSha256,expectedChallengeSha256,
   expectedSessionSha256,anchor.expectedCheckpointSha256].every(validDigest)||
   !Number.isSafeInteger(nowMs)||nowMs<=0||!Buffer.isBuffer(handoffBytes)||
   handoffBytes.length<1||handoffBytes.length>2048||!Buffer.isBuffer(signature)||signature.length!==64||
   !singlePublicPem(signerPublicKeyPem))fail('HANDOFF_TRUST_REQUIRED');
 const b=binding(anchor.installationId,anchor.releaseSha256);
 const bytes=Buffer.from(handoffBytes),sig=Buffer.from(signature);
 if(hash(bytes)!==expectedHandoffSha256)fail('HANDOFF_DIGEST_MISMATCH');
 const key=pinnedKey(signerPublicKeyPem,'HANDOFF_TRUST_REQUIRED');
 if(key.asymmetricKeyType!=='ed25519'||hash(key.export({type:'spki',format:'der'}))!==expectedSignerSpkiSha256||
    !verify(null,bytes,key,sig))fail('HANDOFF_SIGNATURE_INVALID');
 let r;try{r=JSON.parse(bytes.toString('utf8'))}catch{fail('HANDOFF_FORMAT_INVALID')}
 if(!r||typeof r!=='object'||Array.isArray(r)||r.schema_version!==1||
    r.purpose!=='DISPLAY_SETUP_PROGRESS_ONLY'||r.installation_id!==b.installation_id||
    r.release_sha256!==b.release_sha256||r.checkpoint_sha256!==anchor.expectedCheckpointSha256||
    r.challenge_sha256!==expectedChallengeSha256||r.session_sha256!==expectedSessionSha256||
    !Number.isSafeInteger(r.issued_at_ms)||!Number.isSafeInteger(r.expires_at_ms)||
    r.issued_at_ms<=0||r.issued_at_ms>nowMs||r.expires_at_ms<=nowMs||
    r.expires_at_ms-r.issued_at_ms>120000)fail('HANDOFF_BINDING_OR_EXPIRY_INVALID');
 const canonical=Buffer.from(JSON.stringify({schema_version:1,purpose:'DISPLAY_SETUP_PROGRESS_ONLY',
   installation_id:r.installation_id,release_sha256:r.release_sha256,checkpoint_sha256:r.checkpoint_sha256,
   challenge_sha256:r.challenge_sha256,session_sha256:r.session_sha256,
   issued_at_ms:r.issued_at_ms,expires_at_ms:r.expires_at_ms})+'\n');
 if(!bytes.equals(canonical))fail('HANDOFF_FORMAT_INVALID');
 const progress=await inspectSetupProgress(anchor);
 return Object.freeze({handoff_evidence_verified:true,progress,session_authenticated:false,
   challenge_consumed:false,execution_authorized:false,production_accepted:false});
}

// Local POSIX replay tombstone for a verified DISPLAY-only handoff.
// Caller must serialize journal mutation/current anchor custody and use a
// trusted, separate persistent private directory. No rollback resistance
// against deletion or restoration of the entire ledger. Never grants login.
export async function consumeSetupDisplayChallenge({ledgerDirectory,handoff,clock}={}){
 if(!handoff||typeof clock!=='function'||!Buffer.isBuffer(handoff.handoffBytes)||
    !Buffer.isBuffer(handoff.signature)||!Buffer.isBuffer(handoff.anchor?.checkpointBytes)||
    !Buffer.isBuffer(handoff.anchor?.signature))fail('HANDOFF_TRUST_REQUIRED');
 const snapshot={...handoff,handoffBytes:Buffer.from(handoff.handoffBytes),signature:Buffer.from(handoff.signature),
   anchor:{...handoff.anchor,checkpointBytes:Buffer.from(handoff.anchor.checkpointBytes),signature:Buffer.from(handoff.anchor.signature)}};
 const dir=await privateDir(ledgerDirectory);
 const journalDir=resolve(snapshot.anchor.directory);
 if(dir.path===journalDir||dir.path.startsWith(journalDir+'/')||journalDir.startsWith(dir.path+'/'))fail('SEPARATE_HANDOFF_LEDGER_REQUIRED');
 const started=clock();
 const verified=await inspectSetupHandoff({...snapshot,nowMs:started});
 const record=JSON.parse(snapshot.handoffBytes.toString('utf8'));
 const now=clock();
 if(!Number.isSafeInteger(now)||now<started||now>=record.expires_at_ms)fail('HANDOFF_BINDING_OR_EXPIRY_INVALID');
 // Challenge digest alone is the key: changed session/release/payload cannot
 // reuse it. Even an incomplete receipt denies subsequent attempts.
 await assertDir(dir);
 const path=join(dir.path,'consumed-'+snapshot.expectedChallengeSha256+'.json');
 let fd;
 try{
   fd=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 }catch(e){if(e.code==='EEXIST')fail('HANDOFF_CHALLENGE_ALREADY_CONSUMED');throw e}
 try{
   await fd.chmod(0o600);
   await fd.writeFile(JSON.stringify({schema_version:1,handoff_sha256:snapshot.expectedHandoffSha256,consumed_at_ms:now})+'\n');
   await fd.sync();
 }finally{await fd.close()}
 await syncDir(dir);
 // A receipt stays consumed even if fsync crosses expiry. Never return a
 // successful display receipt after expiry or a backward clock jump.
 const finished=clock();
 if(!Number.isSafeInteger(finished)||finished<now||finished>=record.expires_at_ms)fail('HANDOFF_EXPIRED_AFTER_CONSUMPTION');
 return Object.freeze({...verified,challenge_consumed:true,session_authenticated:false,execution_authorized:false,production_accepted:false});
}
