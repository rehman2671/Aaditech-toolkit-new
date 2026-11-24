import {describe,it,expect,vi} from 'vitest';
import {createTroubleshootingIncident as create,inspectTroubleshootingIncident as inspect,recordDiagnosticPlan as plan,inspectDiagnosticPlan,summarizeTroubleshootingIntake as summary} from '../../troubleshooting-incidents.js';
const installationId='6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e',tenant='00000000-0000-4000-8000-000000000001',deviceId='00000000-0000-4000-8000-000000000002',requestId='00000000-0000-4000-8000-000000000003',incidentId='00000000-0000-4000-8000-000000000004';
const principal={id:1,tenant_id:tenant,role:'SUPER_ADMIN'};
const input={principal,installationId,deviceId,requestId,categoryId:'TR-01',hazard:'NONE'};
const row={incident_id:incidentId,installation_id:installationId,tenant_id:tenant,device_id:deviceId,actor_user_id:1,intake_request_id:requestId,category_id:'TR-01',hazard:'NONE',status:'OPEN'};
function fixture({rows=[],plans=[],owner={},user={},audit=1,write=1,commitFails=false}={}){
 const c={beginTransaction:vi.fn(),commit:vi.fn(async()=>{if(commitFails)throw Error('COMMIT_OUTCOME_UNKNOWN')}),rollback:vi.fn(),release:vi.fn(),destroy:vi.fn(),
 query:vi.fn(async sql=>{
  if(sql.includes('FROM devices'))return [[{id:deviceId,tenant_id:tenant,...owner}]];
  if(sql.includes('FROM users'))return [[{id:1,tenant_id:tenant,role:'SUPER_ADMIN',active:1,status:'ACTIVE',...user}]];
  if(sql.startsWith('SELECT * FROM troubleshooting_diagnostic_plans'))return [plans];
  if(sql.startsWith('SELECT'))return [rows];
  if(sql.includes('INSERT INTO troubleshooting_diagnostic_plans'))return [{affectedRows:write}];
  if(sql.includes('INSERT INTO troubleshooting_incidents'))return [{affectedRows:write}];
  if(sql.includes('INSERT INTO audit_logs'))return [{affectedRows:audit}];
  throw Error('unexpected query');
 })};
 return {c,pool:{getConnection:vi.fn(async()=>c)}};
}
describe('internal incident intake reference',()=>{
 it('records one categorical incident and audit atomically, never authorizes actions',async()=>{
  for(const [categoryId,status] of [['TR-01','OPEN'],['TR-24','ESCALATED']]){
   const f=fixture(),result=await create(f.pool,{...input,categoryId});
   expect(result).toMatchObject({category_id:categoryId,status,duplicate:false,diagnostic_authorized:false,repair_authorized:false,production_accepted:false});
   expect(f.c.query.mock.calls.filter(([q])=>q.startsWith('INSERT'))).toHaveLength(2);
   expect(f.c.commit).toHaveBeenCalledOnce();
  }
 });
 it('exact retry is read-only, conflicting device or category fails',async()=>{
  const f=fixture({rows:[row]});expect(await create(f.pool,input)).toMatchObject({incident_id:incidentId,duplicate:true});
  expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);
  for(const patch of [{category_id:'TR-02'},{device_id:tenant},{hazard:'UNKNOWN'}]){
   const x=fixture({rows:[{...row,...patch}]});
   await expect(create(x.pool,input)).rejects.toThrow('INCIDENT_IDEMPOTENCY_CONFLICT');
   expect(x.c.rollback).toHaveBeenCalledOnce();
  }
 });
 it('denies unsafe input, foreign/inactive authority and failed audit or write',async()=>{
  for(const patch of [{freeText:'private'},{categoryId:'TR-99'},{principal:{...principal,role:'USER'}},{hazard:true}]){
   const f=fixture();await expect(create(f.pool,{...input,...patch})).rejects.toThrow();expect(f.pool.getConnection).not.toHaveBeenCalled();
  }
  for(const opts of [{owner:{tenant_id:'other'}},{user:{active:0}},{audit:0},{write:0}]){
   const f=fixture(opts);await expect(create(f.pool,input)).rejects.toThrow();expect(f.c.rollback).toHaveBeenCalledOnce();expect(f.c.commit).not.toHaveBeenCalled();
  }
 });
 it('inspection is scoped and redacted',async()=>{
  const args={principal,installationId,deviceId,incidentId};
  const f=fixture({rows:[row]});const r=await inspect(f.pool,args);
  expect(r.incident_id).toBe(incidentId);expect(r).not.toHaveProperty('installation_id');expect(r).not.toHaveProperty('actor_user_id');
  for(const rows of [[],[{...row,tenant_id:'other'}],[{...row,actor_user_id:2}],[{...row,status:'ESCALATED'}]]){
   const x=fixture({rows});await expect(inspect(x.pool,args)).rejects.toThrow();
  }
 });
});

describe('diagnostic plan persistence',()=>{
 const args={principal,installationId,deviceId,incidentId,requestId};
 it('derives the catalog diagnostic without authorizing execution',async()=>{
  const f=fixture({rows:[row]});expect(await plan(f.pool,args)).toMatchObject({status:'PLANNED_ONLY',diagnostic_id:'RESOURCE_PRESSURE',execution_authorized:false,diagnostic_authorized:false});
  expect(f.c.query.mock.calls.filter(([q])=>q.startsWith('INSERT'))).toHaveLength(2);
 });
 it('returns the same plan on retry without another write',async()=>{
  const f=fixture({rows:[row],plans:[{...row,plan_id:incidentId,request_id:requestId,diagnostic_id:'RESOURCE_PRESSURE'}]});
  expect(await plan(f.pool,args)).toMatchObject({plan_id:incidentId,duplicate:true});
  expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);
 });
 it('blocks hazardous, unknown, forged or unaudited plans',async()=>{
  for(const opts of [{rows:[{...row,category_id:'TR-24',status:'ESCALATED'}]},{rows:[{...row,hazard:'UNKNOWN'}]},{rows:[row],audit:0},{rows:[row],plans:[{...row,plan_id:incidentId,request_id:requestId,diagnostic_id:'WRONG'}]}]){
   const f=fixture(opts);await expect(plan(f.pool,args)).rejects.toThrow();expect(f.c.rollback).toHaveBeenCalledOnce();
  }
  const f=fixture({rows:[row]});await expect(plan(f.pool,{...args,command:'arbitrary'})).rejects.toThrow();expect(f.pool.getConnection).not.toHaveBeenCalled();
 });
});

describe('scoped intake summary',()=>{
 const args={principal,installationId,deviceId};
 it('reports distinct planned incidents but does not invent execution metrics',async()=>{
  const f=fixture({rows:[{reported:'3',open_count:'2',escalated_count:'1',planned_incidents:'1'}]});
  expect(await summary(f.pool,args)).toEqual({reported:3,open:2,escalated:1,incidents_with_plans:1,
   diagnosed:null,executed_attempts:null,verified_resolved:null,resolution_rate:null,outcome_measurement:'NOT_IMPLEMENTED',production_accepted:false});
  expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);
  expect(f.c.query.mock.calls.at(-1)[1]).toEqual([installationId,tenant,deviceId,1]);
 });
 it('rejects missing, inconsistent or coercible counts',async()=>{
  for(const rows of [[],[{reported:null,open_count:0,escalated_count:0,planned_incidents:0}],
   [{reported:2,open_count:1,escalated_count:1,planned_incidents:2}],
   [{reported:3,open_count:1,escalated_count:1,planned_incidents:1}]]){
   const f=fixture({rows});await expect(summary(f.pool,args)).rejects.toThrow('INCIDENT_SUMMARY_UNVERIFIED');
  }
 });
});

describe('incident state and transaction integrity',()=>{
 it('rejects coercible persisted actor IDs and malformed intake identity',async()=>{
  const args={principal,installationId,deviceId,incidentId};
  for(const patch of [{actor_user_id:true},{actor_user_id:'01'},{actor_user_id:'1\n'},{intake_request_id:null},{intake_request_id:'malformed'}]){
   const f=fixture({rows:[{...row,...patch}]});
   await expect(inspect(f.pool,args)).rejects.toThrow('INCIDENT_SCOPE_DENIED');
   expect(f.c.commit).not.toHaveBeenCalled();
  }
  const f=fixture({user:{id:true}});
  await expect(create(f.pool,input)).rejects.toThrow('INCIDENT_SCOPE_DENIED');
 });
 it('rejects noncanonical summary values and overflowing aggregate sums',async()=>{
  const args={principal,installationId,deviceId};
  for(const counts of [{reported:'1\n',open_count:1,escalated_count:0,planned_incidents:0},
    {reported:'01',open_count:1,escalated_count:0,planned_incidents:0},
    {reported:Number.MAX_SAFE_INTEGER,open_count:Number.MAX_SAFE_INTEGER,escalated_count:1,planned_incidents:0}]){
   const f=fixture({rows:[counts]});
   await expect(summary(f.pool,args)).rejects.toThrow('INCIDENT_SUMMARY_UNVERIFIED');
  }
 });
 it('discards an uncertain commit session and never reports an incident as written',async()=>{
  const f=fixture({commitFails:true});
  await expect(create(f.pool,input)).rejects.toThrow('COMMIT_OUTCOME_UNKNOWN');
  expect(f.c.rollback).toHaveBeenCalledOnce();
  expect(f.c.destroy).toHaveBeenCalledOnce();
  expect(f.c.release).not.toHaveBeenCalled();
 });
});

describe('scoped diagnostic plan inspection',()=>{
 const planId='00000000-0000-4000-8000-000000000005';
 const args={principal,installationId,deviceId,incidentId,planId};
 const stored={...row,plan_id:planId,request_id:requestId,diagnostic_id:'RESOURCE_PRESSURE'};
 it('returns a redacted planned-only record using scoped locks and no writes',async()=>{
  const f=fixture({rows:[row],plans:[stored]});
  expect(await inspectDiagnosticPlan(f.pool,args)).toEqual({plan_id:planId,incident_id:incidentId,
   diagnostic_id:'RESOURCE_PRESSURE',status:'PLANNED_ONLY',diagnostic_authorized:false,execution_authorized:false,
   repair_authorized:false,production_accepted:false});
  expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);
  expect(f.c.query.mock.calls.at(-1)[1]).toEqual([planId,incidentId,installationId,tenant,deviceId,1]);
 });
 for(const [key,value] of Object.entries({plan_id:requestId,incident_id:requestId,installation_id:tenant,
  tenant_id:deviceId,device_id:tenant,actor_user_id:'01',request_id:null,diagnostic_id:'UNKNOWN'})){
  it('refuses persisted plan mismatch: '+key,async()=>{
   const f=fixture({rows:[row],plans:[{...stored,[key]:value}]});
   await expect(inspectDiagnosticPlan(f.pool,args)).rejects.toThrow('DIAGNOSTIC_PLAN_STATE_INVALID');
   expect(f.c.rollback).toHaveBeenCalledOnce();expect(f.c.commit).not.toHaveBeenCalled();
  });
 }
 it('rejects unavailable, ambiguous, or no-longer-eligible incident or plan',async()=>{
  for(const opts of [{rows:[],plans:[stored]},{rows:[row],plans:[]},{rows:[row],plans:[stored,stored]},
   {rows:[{...row,hazard:'UNKNOWN'}],plans:[stored]},{rows:[{...row,category_id:'TR-24',status:'ESCALATED'}],plans:[stored]},
   {rows:[row],plans:[stored],user:{active:0}}]){
   const f=fixture(opts);await expect(inspectDiagnosticPlan(f.pool,args)).rejects.toThrow();
   expect(f.c.rollback).toHaveBeenCalledOnce();
  }
 });
 it('refuses malformed plan IDs and caller-selected execution before acquiring connection',async()=>{
  const f=fixture();for(const bad of [{...args,planId:'invalid'},{...args,command:'private'}])
   await expect(inspectDiagnosticPlan(f.pool,bad)).rejects.toThrow('INCIDENT_INVALID');
  expect(f.pool.getConnection).not.toHaveBeenCalled();
 });
});
