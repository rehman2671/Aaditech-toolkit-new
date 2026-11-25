import {it,expect,describe} from 'vitest';
import {mkdtemp,mkdir,writeFile,readdir,rm,chmod,symlink,link,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {guidedPrivateStackSteps as steps,guidedStartedDigest,encodeGuidedOperationEvent as encode,inspectGuidedEventChain as chain,validateGuidedJournalPolicy as validate,inspectGuidedOperationJournal as inspect} from '../../scripts/guided-operation-journal.mjs';
const project='aaditech',release='a'.repeat(64),zero='0'.repeat(64);
const sha=x=>createHash('sha256').update(x).digest('hex');
function records(count){
 let previous=zero;const result=[];
 for(let i=0;i<count;i++){
  const step=steps[Math.floor(i/2)],event=i%2?'COMPLETED':'STARTED';
  const bytes=encode({schema_version:1,sequence:i+1,project,release_sha256:release,step,event,previous_sha256:previous,evidence_sha256:event==='STARTED'?guidedStartedDigest(step,release):'b'.repeat(64)});
  result.push(bytes);previous=sha(bytes);
 }
 return result;
}
it.each(Array.from({length:15},(_,i)=>i))('classifies exact recorded prefix of %i events',n=>{
 const r=records(n),head=n?sha(r[n-1]):zero;
 expect(chain(r,project,release,{sequence:n,sha256:head})).toMatchObject({sequence:n,completed:Math.floor(n/2),pending:n%2?steps[Math.floor(n/2)]:null,independent_head_matched:true});
 expect(chain(r,project,release).independent_head_matched).toBe(false);
});
it('rejects noncanonical, reordered, cross-project and changed evidence records',()=>{
 const r=records(4),first=JSON.parse(r[0]);
 for(const x of [{...first,step:'IDENTITY'},{...first,event:'COMPLETED'},{...first,sequence:0},{...first,previous_sha256:'f'.repeat(64)},{...first,evidence_sha256:'b'.repeat(64)},{...first,project:'different'},{...first,release_sha256:'c'.repeat(64)},{...first,extra:true}]){
  expect(()=>chain([Buffer.from(JSON.stringify(x)+'\n'),...r.slice(1)],project,release)).toThrow();
 }
 expect(()=>chain([r[1],r[0]],project,release)).toThrow();
 expect(()=>chain([r[0],r[2]],project,release)).toThrow();
 expect(()=>chain([Buffer.concat([r[0],Buffer.from(' ')])],project,release)).toThrow();
 expect(()=>chain([Buffer.from(r[0].toString().replace('"schema_version":1','"schema_version":1,"schema_version":1'))],project,release)).toThrow();
 expect(()=>chain(r,project,release,{sequence:3,sha256:sha(r[2])})).toThrow();
 expect(()=>chain(r.slice(0,3),project,release,{sequence:4,sha256:sha(r[3])})).toThrow();
 expect(()=>chain(r,project,release,{sequence:4,sha256:'f'.repeat(64)})).toThrow();
});
const policy={confirmation:'INSPECT_GUIDED_OPERATION_HISTORY_ONLY',project,releaseSha256:release,journalDirectory:'/private/journal',operationLockRoot:'/private/operation',adapterLockRoot:'/private/adapter',expectedHead:null};
it.each([{confirmation:'yes'},{project:'../x'},{project:'aaditech\n'},{releaseSha256:zero},{journalDirectory:'relative'},{journalDirectory:'/private'},{operationLockRoot:'/private/journal'},{adapterLockRoot:'/private/operation/child'},{expectedHead:{sequence:0,sha256:release}},{expectedHead:{sequence:2,sha256:zero}},{expectedHead:{sequence:15,sha256:release}},{resume:true}])('rejects unsafe inspection policy %j',patch=>expect(()=>validate({...policy,...patch})).toThrow());
describe.skipIf(process.platform!=='linux')('actual read-only private filesystem observations',()=>{
 async function fixture(n,fn){
  const root=await mkdtemp(join(await realpath(tmpdir()),'guided-history-'));
  try{
   const p={...policy,journalDirectory:join(root,'journal'),operationLockRoot:join(root,'operation'),adapterLockRoot:join(root,'adapter')};
   for(const d of [p.journalDirectory,p.operationLockRoot,p.adapterLockRoot])await mkdir(d,{mode:0o700});
   const r=records(n);
   for(let i=0;i<r.length;i++)await writeFile(join(p.journalDirectory,'event-'+String(i+1).padStart(3,'0')+'.json'),r[i],{mode:0o600});
   await fn(p,r,root);
  }finally{await rm(root,{recursive:true,force:true})}
 }
 it.each([[0,'NO_OPERATION_RECORDED'],[1,'OPERATOR_RECONCILIATION_REQUIRED'],[2,'PARTIAL_HISTORY_RECONCILIATION_REQUIRED'],[14,'RECORDED_COMPLETE_REVALIDATE_ACTUAL_STACK']])('observes %i records without authorizing execution',async(n,decision)=>fixture(n,async(p,r)=>{
  const proof=await inspect({...p,expectedHead:{sequence:n,sha256:n?sha(r[n-1]):zero}});
  expect(proof).toMatchObject({decision,independent_head_matched:true,actual_resources_verified:false,writer_quiescence_verified:false,resume_authorized:false,rollback_authorized:false,execution_authorized:false,production_accepted:false});
  expect(await readdir(p.operationLockRoot)).toEqual([]);expect(await readdir(p.adapterLockRoot)).toEqual([]);
  expect((await readdir(p.journalDirectory)).length).toBe(n);
 }));
 it('preserves active/retained and incomplete lock markers without exposing lock ID',()=>fixture(14,async(p)=>{
  const path=join(p.operationLockRoot,'setup.lock'),owner=join(path,'owner.json'),id='12345678-1234-4234-8234-123456789abc';
  await mkdir(path,{mode:0o700});
  expect(await inspect(p)).toMatchObject({operation_lock_state:'INCOMPLETE_LOCK',decision:'OPERATOR_RECONCILIATION_REQUIRED'});
  const bytes=JSON.stringify({schema_version:1,lock_id:id})+'\n';
  await writeFile(owner,bytes,{mode:0o600});
  const proof=await inspect(p);
  expect(proof).toMatchObject({operation_lock_state:'RETAINED_OR_ACTIVE',decision:'OPERATOR_RECONCILIATION_REQUIRED'});
  expect(JSON.stringify(proof)).not.toContain(id);expect(await readFile(owner,'utf8')).toBe(bytes);
 }));
 it.each(['extra','gap','mode','directory-mode','hardlink','symlink','tamper','lock-extra','lock-malformed','wrong-head'])('refuses %s without repairing files',reason=>fixture(2,async(p,r,root)=>{
  const first=join(p.journalDirectory,'event-001.json'),second=join(p.journalDirectory,'event-002.json');
  let q=p;
  if(reason==='extra')await writeFile(join(p.journalDirectory,'unexpected'),'x',{mode:0o600});
  if(reason==='gap')await rm(first);
  if(reason==='mode')await chmod(first,0o644);
  if(reason==='directory-mode')await chmod(p.journalDirectory,0o755);
  if(reason==='hardlink')await link(first,join(root,'copy'));
  if(reason==='symlink'){await rm(first);await symlink(second,first)}
  if(reason==='tamper')await writeFile(first,Buffer.from('bad'));
  if(reason==='lock-extra')await writeFile(join(p.adapterLockRoot,'unknown'),'x',{mode:0o600});
  if(reason==='lock-malformed'){const d=join(p.adapterLockRoot,'setup.lock');await mkdir(d,{mode:0o700});await writeFile(join(d,'owner.json'),'{}',{mode:0o600})}
  if(reason==='wrong-head')q={...p,expectedHead:{sequence:1,sha256:sha(r[0])}};
  await expect(inspect(q)).rejects.toThrow();
 }));
});
