// Explicit local replay ledger for independently pinned review proofs.
// One challenge is consumed at most once in this owner-controlled ledger.
// Not distributed replay protection, endpoint execution or attempt acceptance.
import {constants} from 'node:fs';
import {open,lstat,realpath,link,unlink} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {reviewRetainedDiagnosticArtifact} from './review-retained-diagnostic-artifact.mjs';
const fail=()=>{throw Error('LOCAL_DIAGNOSTIC_REVIEW_LEDGER_UNVERIFIED')};
const sha=b=>createHash('sha256').update(b).digest('hex');
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value'));
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const same=(a,b)=>['dev','ino','uid','mode'].every(k=>a[k]===b[k]);
async function privateDir(p,expected){
 if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p||p.length>4096||/[\x00-\x1f\x7f]/.test(p))fail();
 const s=await lstat(p);if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(p)!==p||(expected&&!same(s,expected)))fail();return s;
}
export async function recordRetainedDiagnosticReview(input){
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||!exact(input,['confirmation','ledgerDirectory','review'])||input.confirmation!=='RECORD_LOCAL_REVIEW_ONCE_ONLY')fail();
 // Snapshot plain JSON input; reject non-JSON caller objects by exact validation.
 const {ledgerDirectory}=input;
 const review=structuredClone(input.review);
 const st=await privateDir(ledgerDirectory);
 const artifactDir=await privateDir(review.directory);
 if(same(st,artifactDir)||ledgerDirectory.startsWith(review.directory+'/')||review.directory.startsWith(ledgerDirectory+'/'))fail();
 const expected=review.expected;
 if(!expected||!digest(expected.challengeSha256)||!digest(expected.payloadSha256)||!digest(expected.artifactSha256))fail();
 const result=await reviewRetainedDiagnosticArtifact(review);
 // The proof is checked immediately before creating the durable receipt.
 const name=expected.challengeSha256+'.json',dest=join(ledgerDirectory,name),tmp=join(ledgerDirectory,'.review-'+randomUUID()+'.tmp');
 const record={schema_version:1,challenge_sha256:expected.challengeSha256,payload_sha256:expected.payloadSha256,artifact_sha256:expected.artifactSha256,
  scope_sha256:sha(Buffer.from(JSON.stringify([expected.installationId,expected.tenantId,expected.deviceId,expected.incidentId,expected.planId,expected.diagnosticId,expected.credentialFingerprint,expected.signerSpkiSha256]))),
  review_only:true,attempt_accepted:false};
 const bytes=Buffer.from(JSON.stringify(record)+'\n');
 let created=false;
 try{
  const f=await open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;
  try{await f.chmod(0o600);await f.writeFile(bytes);await f.sync()}finally{await f.close()}
  await privateDir(ledgerDirectory,st);
  try{await link(tmp,dest)}catch(e){if(e.code==='EEXIST')throw Error('LOCAL_DIAGNOSTIC_CHALLENGE_ALREADY_RECORDED');throw e}
 }finally{if(created)await unlink(tmp)}
 const d=await open(ledgerDirectory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{if(!same(st,await d.stat()))fail();await d.sync()}finally{await d.close()}
 await privateDir(ledgerDirectory,st);
 const f=await open(dest,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await f.stat();
  if(!before.isFile()||before.nlink!==1||before.uid!==process.geteuid()||(before.mode&0o7777)!==0o600||before.size!==bytes.length)fail();
  const actual=await f.readFile(),after=await f.stat(),current=await lstat(dest);
  if(!actual.equals(bytes)||[after,current].some(x=>!same(x,before)||x.size!==before.size||x.nlink!==1||x.ctimeMs!==before.ctimeMs||x.mtimeMs!==before.mtimeMs))fail();
 }finally{await f.close()}
 return Object.freeze({...result,local_review_recorded:true,local_challenge_consumed:true,local_receipt_sha256:sha(bytes),distributed_replay_protection_verified:false,attempt_accepted:false});
}
