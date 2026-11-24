import {describe,it,expect} from 'vitest';
import {mkdtemp,chmod,rm,realpath,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectSetupJournal,appendSetupJournalEvent} from '../../scripts/setup-journal-posix.mjs';
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
