import {test} from 'vitest';
import {verifyRecoveredTelemetryReceipt,recoverCommittedTelemetryReceipt} from '../../telemetry-commit-recovery.js';
function buildCases(){
 const cases=[],add=(name,run)=>cases.push([name,run]),eq=(x,y)=>{if(JSON.stringify(x)!==JSON.stringify(y))throw Error('assertion mismatch')};
 const expected={tenantId:'t',deviceId:'d',batchId:'key',hash:'a'.repeat(64),tokenHash:'b'.repeat(64),accepted:2};
 const row={tenant_id:'t',device_id:'d',batch_id:'key',request_hash:expected.hash,device_token_hash:expected.tokenHash,agent_token_revoked:0,accepted_count:2,recorded_at:'2026-11-26T00:00:00.000Z'};
 const answer={duplicate:true,accepted:2,recorded_at:new Date(row.recorded_at),batch_id:'key'};
 for(const [field,values] of Object.entries({tenant_id:['T','foreign',null],device_id:['D','foreign',null],batch_id:['KEY','other',null],request_hash:['c'.repeat(64),'',null],device_token_hash:['c'.repeat(64),'',null],agent_token_revoked:[1,true,null,undefined,'1','false'],accepted_count:[0,1,3,'02',true,null,2.5],recorded_at:[null,0,{},'invalid','1999-01-01T00:00:00Z','2026','2026-11-26']}))for(const [i,value] of values.entries())add('reject receipt '+field+' '+i,()=>eq(verifyRecoveredTelemetryReceipt([{...row,[field]:value}],expected),null));
 for(const rows of [null,{},[],[row,row],[null]])add('reject receipt cardinality '+JSON.stringify(rows),()=>eq(verifyRecoveredTelemetryReceipt(rows,expected),null));
 for(const count of [2,'2'])for(const revoked of [0,false,'0'])add('verified receipt '+count+' '+String(revoked),()=>eq(verifyRecoveredTelemetryReceipt([{...row,accepted_count:count,agent_token_revoked:revoked}],expected),answer));
 const fixture=(failure=null,ownerPatch={},receiptRows=[row])=>{
  const events=[],owner={id:'d',tenant_id:'t',device_token_hash:expected.tokenHash,agent_token_revoked:0,...ownerPatch};
  const conn={async beginTransaction(){events.push('begin');if(failure==='begin')throw Error('fixture')},async query(sql,args){const type=sql.includes('FROM devices')?'owner':'receipt';events.push(type);if(failure===type)throw Error('fixture');if(!sql.includes('FOR UPDATE'))throw Error('missing lock');eq(args,type==='owner'?['d','t']:['t','d','key']);return [type==='owner'?[owner]:receiptRows]},async rollback(){events.push('rollback');if(failure==='rollback')throw Error('fixture')},release(){events.push('release');if(failure==='release')throw Error('fixture')},destroy(){events.push('destroy')}};
  return {events,acquire:async()=>{events.push('acquire');if(failure==='acquire')throw Error('fixture');return conn},isCurrent:()=>true};
 };
 for(const failure of ['acquire','begin','owner','receipt','rollback','release'])add('recovery failure '+failure,async()=>{const f=fixture(failure);eq(await recoverCommittedTelemetryReceipt({expected,...f}),null);if(!['acquire','release'].includes(failure))eq(f.events.at(-1),'destroy')});
 for(const owner of [{id:'foreign'},{tenant_id:'foreign'},{device_token_hash:'c'.repeat(64)},{agent_token_revoked:1},{agent_token_revoked:null}])add('recovery denies owner '+JSON.stringify(owner),async()=>{const f=fixture(null,owner);eq(await recoverCommittedTelemetryReceipt({expected,...f}),null);eq(f.events,['acquire','begin','owner','destroy'])});
 add('recovery confirms committed receipt without writes',async()=>{const f=fixture();eq(await recoverCommittedTelemetryReceipt({expected,...f}),answer);eq(f.events,['acquire','begin','owner','receipt','rollback','release'])});
 add('no committed receipt means no acknowledgement',async()=>{const f=fixture(null,{},[]);eq(await recoverCommittedTelemetryReceipt({expected,...f}),null);eq(f.events,['acquire','begin','owner','receipt','rollback','release'])});
 for(const at of [1,2,3])add('pool replacement check '+at,async()=>{const f=fixture();let count=0;eq(await recoverCommittedTelemetryReceipt({expected,...f,isCurrent:()=>++count<at}),null);if(at===1)eq(f.events,[]);if(at===2)eq(f.events,['acquire','destroy'])});
 add('missing credential never opens connection',async()=>{const f=fixture();eq(await recoverCommittedTelemetryReceipt({expected:{...expected,tokenHash:undefined},...f}),null);eq(f.events,[])});
 return cases;
}
for(const [name,run] of buildCases())test(name,run);
