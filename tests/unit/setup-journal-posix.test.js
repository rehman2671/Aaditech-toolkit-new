import {describe,it,expect} from 'vitest';
import {mkdtemp,chmod,rm,realpath,readFile,writeFile,link,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {inspectSetupJournal,appendSetupJournalEvent,inspectAnchoredSetupJournal,inspectSetupProgress,inspectSetupHandoff,consumeSetupDisplayChallenge} from '../../scripts/setup-journal-posix.mjs';
const id='6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e';
const release='a'.repeat(64),evidence='b'.repeat(64);
async function fixture(run){
 const directory=await mkdtemp(join(await realpath(tmpdir()),'itk-journal-'));
 try{
  await chmod(directory,0o700);
  const input={directory,installationId:id,releaseSha256:release};
  const read=()=>inspectSetupJournal(input);
  const append=async(step,event,previous)=>{
    const state=previous||await read();
    return appendSetupJournalEvent({...input,step,event,evidenceSha256:evidence,
      expectedSequence:state.sequence,expectedPreviousSha256:state.previous_sha256});
  };
  await run({input,read,append,directory});
 }finally{await rm(directory,{recursive:true,force:true})}
}
describe.skipIf(process.platform==='win32')('durable setup journal reference',()=>{
 it('persists start before work, interrupted start requires reconciliation and never authorizes replay',()=>fixture(async f=>{
  const initial=await f.read();
  expect(initial).toMatchObject({sequence:0,pending:null,execution_authorized:false});
  await f.append('PREFLIGHT','STARTED');
  expect(await f.read()).toMatchObject({pending:'PREFLIGHT',decision:'OPERATOR_RECONCILIATION_REQUIRED',execution_authorized:false});
  await expect(f.append('PREFLIGHT','STARTED')).rejects.toThrow('JOURNAL_STEP_ORDER_INVALID');
  await expect(f.append('TRUST','STARTED')).rejects.toThrow('JOURNAL_STEP_ORDER_INVALID');
  await f.append('PREFLIGHT','COMPLETED');
  expect(await f.read()).toMatchObject({completed:1,pending:null,production_accepted:false});
  await expect(f.append('API','STARTED')).rejects.toThrow('JOURNAL_STEP_ORDER_INVALID');
 }));
 it('concurrent append cannot overwrite winner or accept stale head',()=>fixture(async f=>{
  const initial=await f.read();
  const results=await Promise.allSettled([f.append('PREFLIGHT','STARTED',initial),f.append('PREFLIGHT','STARTED',initial)]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const path=join(f.directory,'event-001.json'),before=await readFile(path);
  await expect(f.append('PREFLIGHT','STARTED',initial)).rejects.toThrow('STALE_JOURNAL_STATE');
  expect(await readFile(path)).toEqual(before);
 }));
 it('rejects wrong release binding, corrupted record, gap and orphan evidence',()=>fixture(async f=>{
  await f.append('PREFLIGHT','STARTED');
  await expect(inspectSetupJournal({...f.input,releaseSha256:'c'.repeat(64)})).rejects.toThrow('JOURNAL_BINDING_OR_ORDER_INVALID');
  await writeFile(join(f.directory,'.orphan.tmp'),'unfinished',{mode:0o600});
  await expect(f.read()).rejects.toThrow('JOURNAL_INCOMPLETE_OR_UNEXPECTED');
  await rm(join(f.directory,'.orphan.tmp'));
  await f.append('PREFLIGHT','COMPLETED');
  await writeFile(join(f.directory,'event-001.json'),'{}');
  await expect(f.read()).rejects.toThrow('JOURNAL_BINDING_OR_ORDER_INVALID');
  await rm(join(f.directory,'event-001.json'));
  await expect(f.read()).rejects.toThrow('JOURNAL_INCOMPLETE_OR_UNEXPECTED');
 }));
});

const digest=b=>createHash('sha256').update(b).digest('hex');
function checkpoint(input,state,keys=generateKeyPairSync('ed25519')){
 const checkpointBytes=Buffer.from(JSON.stringify({schema_version:1,
   installation_id:input.installationId,release_sha256:input.releaseSha256,
   sequence:state.sequence,record_sha256:state.previous_sha256})+'\n');
 return {...input,checkpointBytes,signature:sign(null,checkpointBytes,keys.privateKey),
  signerPublicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),
  expectedSignerSpkiSha256:digest(keys.publicKey.export({type:'spki',format:'der'})),
  expectedCheckpointSha256:digest(checkpointBytes)};
}
describe.skipIf(process.platform==='win32')('independently pinned journal checkpoint',()=>{
 it('accepts exact signed head but refuses valid suffix truncation and full rollback',()=>fixture(async f=>{
  await f.append('PREFLIGHT','STARTED');
  await f.append('PREFLIGHT','COMPLETED');
  const anchor=checkpoint(f.input,await f.read());
  expect(await inspectAnchoredSetupJournal(anchor)).toMatchObject({
    checkpoint_verified:true,sequence:2,execution_authorized:false,production_accepted:false});
  await rm(join(f.directory,'event-002.json'));
  expect(await f.read()).toMatchObject({sequence:1,pending:'PREFLIGHT'});
  await expect(inspectAnchoredSetupJournal(anchor)).rejects.toThrow('CHECKPOINT_HEAD_MISMATCH');
  await rm(join(f.directory,'event-001.json'));
  await expect(inspectAnchoredSetupJournal(anchor)).rejects.toThrow('CHECKPOINT_HEAD_MISMATCH');
 }));
 it('refuses old signed checkpoint when current independent digest differs or local head advanced',()=>fixture(async f=>{
  const keys=generateKeyPairSync('ed25519');
  await f.append('PREFLIGHT','STARTED');
  const old=checkpoint(f.input,await f.read(),keys);
  await f.append('PREFLIGHT','COMPLETED');
  const current=checkpoint(f.input,await f.read(),keys);
  await expect(inspectAnchoredSetupJournal(old)).rejects.toThrow('CHECKPOINT_HEAD_MISMATCH');
  await expect(inspectAnchoredSetupJournal({...old,expectedCheckpointSha256:current.expectedCheckpointSha256}))
    .rejects.toThrow('CHECKPOINT_DIGEST_MISMATCH');
 }));
 it('rejects missing pins, wrong key, signature, foreign binding and genesis checkpoint',()=>fixture(async f=>{
  const genesis=checkpoint(f.input,await f.read());
  await expect(inspectAnchoredSetupJournal(genesis)).rejects.toThrow('CHECKPOINT_BINDING_INVALID');
  await f.append('PREFLIGHT','STARTED');
  const anchor=checkpoint(f.input,await f.read());
  await expect(inspectAnchoredSetupJournal({...anchor,expectedCheckpointSha256:undefined})).rejects.toThrow('CHECKPOINT_TRUST_REQUIRED');
  await expect(inspectAnchoredSetupJournal({...anchor,expectedSignerSpkiSha256:'c'.repeat(64)})).rejects.toThrow('CHECKPOINT_SIGNER_MISMATCH');
  await expect(inspectAnchoredSetupJournal({...anchor,signature:Buffer.alloc(64)})).rejects.toThrow('CHECKPOINT_SIGNATURE_INVALID');
  await expect(inspectAnchoredSetupJournal({...anchor,releaseSha256:'c'.repeat(64)})).rejects.toThrow('CHECKPOINT_BINDING_INVALID');
  expect(await inspectAnchoredSetupJournal(anchor)).toMatchObject({decision:'OPERATOR_RECONCILIATION_REQUIRED',execution_authorized:false});
 }));
});

describe.skipIf(process.platform==='win32')('redacted setup progress projection',()=>{
 it('distinguishes recorded completion from actual readiness and pending work',()=>fixture(async f=>{
  await f.append('PREFLIGHT','STARTED');await f.append('PREFLIGHT','COMPLETED');
  await f.append('TRUST','STARTED');
  const anchor=checkpoint(f.input,await f.read());
  const view=await inspectSetupProgress(anchor);
  expect(view).toMatchObject({next_step:'TRUST',decision:'OPERATOR_RECONCILIATION_REQUIRED',
    checkpoint_verified:true,actual_readiness_verified:false,execution_authorized:false,production_accepted:false});
  expect(view.steps.map(s=>s.status)).toEqual(['RECORDED_COMPLETE','RECONCILIATION_REQUIRED',...Array(4).fill('NOT_RECORDED')]);
  for(const secret of [id,release,evidence,f.directory,anchor.expectedCheckpointSha256])expect(JSON.stringify(view)).not.toContain(secret);
  expect(Object.isFrozen(view.steps)).toBe(true);
  await f.append('TRUST','COMPLETED');
  await expect(inspectSetupProgress(anchor)).rejects.toThrow('CHECKPOINT_HEAD_MISMATCH');
 }));
 it('all recorded steps are not release acceptance',()=>fixture(async f=>{
  for(const step of ['PREFLIGHT','TRUST','DATABASE','API','ADMIN','AGENT']){
    await f.append(step,'STARTED');await f.append(step,'COMPLETED');
  }
  const view=await inspectSetupProgress(checkpoint(f.input,await f.read()));
  expect(view.next_step).toBeNull();expect(view.steps.every(s=>s.status==='RECORDED_COMPLETE')).toBe(true);
  expect(view.actual_readiness_verified).toBe(false);expect(view.production_accepted).toBe(false);
 }));
});

describe.skipIf(process.platform==='win32')('short-lived signed setup display binding',()=>{
 it('verifies exact signed handoff and current journal, never authenticates or consumes session',()=>fixture(async f=>{
  await f.append('PREFLIGHT','STARTED');
  const anchor=checkpoint(f.input,await f.read());
  const keys=generateKeyPairSync('ed25519'),nowMs=1700000000000;
  const expectedChallengeSha256='d'.repeat(64),expectedSessionSha256='e'.repeat(64);
  const doc={schema_version:1,purpose:'DISPLAY_SETUP_PROGRESS_ONLY',installation_id:id,release_sha256:release,
    checkpoint_sha256:anchor.expectedCheckpointSha256,challenge_sha256:expectedChallengeSha256,
    session_sha256:expectedSessionSha256,issued_at_ms:nowMs-1000,expires_at_ms:nowMs+1000};
  const handoff=patch=>{
   const handoffBytes=Buffer.from(JSON.stringify({...doc,...patch})+'\n');
   return {anchor,handoffBytes,signature:sign(null,handoffBytes,keys.privateKey),nowMs,
     expectedChallengeSha256,expectedSessionSha256,expectedHandoffSha256:digest(handoffBytes),
     signerPublicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),
     expectedSignerSpkiSha256:digest(keys.publicKey.export({type:'spki',format:'der'}))};
  };
  const args=handoff({}),result=await inspectSetupHandoff(args);
  expect(result).toMatchObject({handoff_evidence_verified:true,session_authenticated:false,
    challenge_consumed:false,execution_authorized:false,production_accepted:false,
    progress:{decision:'OPERATOR_RECONCILIATION_REQUIRED'}});
  expect(JSON.stringify(result)).not.toContain(expectedSessionSha256);
  for(const patch of [{purpose:'LOGIN'},{expires_at_ms:nowMs},{issued_at_ms:nowMs+1},
    {expires_at_ms:nowMs+120001},{session_sha256:'a'.repeat(64)},{challenge_sha256:'a'.repeat(64)},
    {checkpoint_sha256:'a'.repeat(64)},{installation_id:'00000000-0000-4000-8000-000000000001'},{extra:true}])
    await expect(inspectSetupHandoff(handoff(patch))).rejects.toThrow();
  await expect(inspectSetupHandoff({...args,signature:Buffer.alloc(64)})).rejects.toThrow();
  await expect(inspectSetupHandoff({...args,expectedHandoffSha256:'a'.repeat(64)})).rejects.toThrow();
  const ledgerDirectory=await mkdtemp(join(await realpath(tmpdir()),'itk-handoff-'));
  try {
   await chmod(ledgerDirectory,0o700);
   const consume=()=>consumeSetupDisplayChallenge({ledgerDirectory,handoff:args,clock:()=>nowMs});
   let reads=0;
   await expect(consumeSetupDisplayChallenge({ledgerDirectory,handoff:args,clock:()=>++reads===1?nowMs:nowMs+1000})).rejects.toThrow('HANDOFF_BINDING_OR_EXPIRY_INVALID');
   const results=await Promise.allSettled(Array.from({length:4},consume));
   expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
   expect(results.find(x=>x.status==='fulfilled').value).toMatchObject({challenge_consumed:true,session_authenticated:false,execution_authorized:false});
   await expect(consume()).rejects.toThrow('HANDOFF_CHALLENGE_ALREADY_CONSUMED');
   const expiredLedger=await mkdtemp(join(await realpath(tmpdir()),'itk-expired-handoff-'));
   try{
    let n=0;
    await expect(consumeSetupDisplayChallenge({ledgerDirectory:expiredLedger,handoff:args,clock:()=>++n<3?nowMs:nowMs+1000})).rejects.toThrow('HANDOFF_EXPIRED_AFTER_CONSUMPTION');
    await expect(consumeSetupDisplayChallenge({ledgerDirectory:expiredLedger,handoff:args,clock:()=>nowMs})).rejects.toThrow('HANDOFF_CHALLENGE_ALREADY_CONSUMED');
   }finally{await rm(expiredLedger,{recursive:true,force:true})}
  }finally{await rm(ledgerDirectory,{recursive:true,force:true})}
  await f.append('PREFLIGHT','COMPLETED');
  await expect(inspectSetupHandoff(args)).rejects.toThrow('CHECKPOINT_HEAD_MISMATCH');
 }));
});


describe.skipIf(process.platform!=='linux')('strict journal custody and anchored input boundaries',()=>{
 const appendInput=f=>({...f.input,step:'PREFLIGHT',event:'STARTED',evidenceSha256:evidence,expectedSequence:0,expectedPreviousSha256:'0'.repeat(64)});
 it.each([0o755,0o500,0o1700,0o2700,0o4700])('refuses directory mode %s',mode=>fixture(async f=>{
  await chmod(f.directory,mode);try{await expect(f.read()).rejects.toThrow('PRIVATE_JOURNAL_REQUIRED')}finally{await chmod(f.directory,0o700)}
 }));
 it.each([0o644,0o400,0o1600,0o2600,0o4600])('refuses record mode %s',mode=>fixture(async f=>{
  await f.append('PREFLIGHT','STARTED');await chmod(join(f.directory,'event-001.json'),mode);
  await expect(f.read()).rejects.toThrow('INVALID_JOURNAL_FILE');
 }));
 it.each(['relative','control','nul','alias','oversize'])('refuses %s directory path',kind=>fixture(async f=>{
  const path=kind==='relative'?'.':kind==='control'?f.directory+'\n':kind==='nul'?f.directory+'\0':kind==='alias'?f.directory+'/../'+f.directory.split('/').at(-1):'/'+ 'x'.repeat(4096);
  await expect(inspectSetupJournal({...f.input,directory:path})).rejects.toThrow('PRIVATE_JOURNAL_REQUIRED');
 }));
 it.each([null,1,-1,1.5,'0',NaN,Infinity,13])('refuses stale or invalid sequence %j',seq=>fixture(async f=>{
  await expect(appendSetupJournalEvent({...appendInput(f),expectedSequence:seq})).rejects.toThrow('STALE_JOURNAL_STATE');
  expect((await f.read()).sequence).toBe(0);
 }));
 it.each(['','0'.repeat(64),'a'.repeat(63),'A'.repeat(64),'g'.repeat(64),null])('refuses invalid evidence digest %j',value=>fixture(async f=>{
  await expect(appendSetupJournalEvent({...appendInput(f),evidenceSha256:value})).rejects.toThrow('EVIDENCE_DIGEST_REQUIRED');
  expect((await f.read()).sequence).toBe(0);
 }));
 it.each(['','0'.repeat(64),'a'.repeat(63),'A'.repeat(64),'g'.repeat(64),null])('refuses invalid release digest %j',value=>fixture(async f=>{
  await expect(inspectSetupJournal({...f.input,releaseSha256:value})).rejects.toThrow('RELEASE_DIGEST_REQUIRED');
 }));
 it.each(['directory','symlink','hardlink','oversized','invalid UTF8','unexpected','too many'])('refuses %s journal entry',kind=>fixture(async f=>{
  const path=join(f.directory,'event-001.json');
  if(kind==='directory')await mkdir(path);
  else if(kind==='symlink')await symlink('missing',path);
  else if(kind==='hardlink'){await f.append('PREFLIGHT','STARTED');await link(path,join(f.directory,'event-002.json'))}
  else if(kind==='oversized')await writeFile(path,Buffer.alloc(2049),{mode:0o600});
  else if(kind==='invalid UTF8')await writeFile(path,Buffer.from([255]),{mode:0o600});
  else if(kind==='unexpected')await writeFile(join(f.directory,'unknown'),'x',{mode:0o600});
  else for(let i=1;i<=13;i++)await writeFile(join(f.directory,'event-'+String(i).padStart(3,'0')+'.json'),'x',{mode:0o600});
  await expect(f.read()).rejects.toThrow();
 }));
 it.each(['concatenated','trailing newline','invalid base64','private key header','missing'])('refuses %s checkpoint PEM',kind=>fixture(async f=>{
  await f.append('PREFLIGHT','STARTED');
  const a=checkpoint(f.input,await f.read()),p=a.signerPublicKeyPem;
  const pem=kind==='concatenated'?p+p:kind==='trailing newline'?p+'\n\n':kind==='invalid base64'?'-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n':kind==='private key header'?p.replaceAll('PUBLIC KEY','PRIVATE KEY'):undefined;
  await expect(inspectAnchoredSetupJournal({...a,signerPublicKeyPem:pem})).rejects.toThrow('CHECKPOINT_TRUST_REQUIRED');
 }));
 it.each(['expectedSignerSpkiSha256','expectedCheckpointSha256'])('refuses zero pin %s',key=>fixture(async f=>{
  await f.append('PREFLIGHT','STARTED');const a=checkpoint(f.input,await f.read());
  await expect(inspectAnchoredSetupJournal({...a,[key]:'0'.repeat(64)})).rejects.toThrow('CHECKPOINT_TRUST_REQUIRED');
 }));
 it('validates zero genesis sequence and retains the exact persisted chain',()=>fixture(async f=>{
  const result=await appendSetupJournalEvent(appendInput(f));
  expect(result).toMatchObject({recorded:true,sequence:1,execution_authorized:false});
  const state=await f.read();expect(state.previous_sha256).toBe(result.record_sha256);
 }));
});
