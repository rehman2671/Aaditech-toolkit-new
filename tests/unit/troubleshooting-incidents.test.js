import {describe,it,expect,vi} from 'vitest';
import {createTroubleshootingIncident as create,inspectTroubleshootingIncident as inspect,recordDiagnosticPlan as plan} from '../../troubleshooting-incidents.js';
const installationId='6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e',tenant='00000000-0000-4000-8000-000000000001',deviceId='00000000-0000-4000-8000-000000000002',requestId='00000000-0000-4000-8000-000000000003',incidentId='00000000-0000-4000-8000-000000000004';
const principal={id:1,tenant_id:tenant,role:'SUPER_ADMIN'};
const input={principal,installationId,deviceId,requestId,categoryId:'TR-01',hazard:'NONE'};
const row={incident_id:incidentId,installation_id:installationId,tenant_id:tenant,device_id:deviceId,actor_user_id:1,intake_request_id:requestId,category_id:'TR-01',hazard:'NONE',status:'OPEN'};
function fixture({rows=[],plans=[],owner={},user={},audit=1,write=1}={}){
 const c={beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),destroy:vi.fn(),
 query:vi.fn(async sql=>{
  if(sql.includes('FROM devices'))return [[{id:deviceId,tenant_id:tenant,...owner}]];
  if(sql.includes('FROM users'))return [[{id:1,tenant_id:tenant,role:'SUPER_ADMIN',active:1,status:'ACTIVE',...user}]];
  if(sql.includes('FROM troubleshooting_diagnostic_plans'))return [plans];
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
