import {describe,it,expect,vi} from 'vitest';
import {changeEmployeeReportBinding as change,createEmployeeTroubleshootingReport as report} from '../../troubleshooting-incidents.js';
import {troubleshootingCatalog} from '../../troubleshooting-policy.js';
const installationId='6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e',tenant='00000000-0000-4000-8000-000000000001',deviceId='00000000-0000-4000-8000-000000000002',requestId='00000000-0000-4000-8000-000000000003',incidentId='00000000-0000-4000-8000-000000000004',bindingId='00000000-0000-4000-8000-000000000005';
const admin={id:1,tenant_id:tenant,role:'SUPER_ADMIN'},employee={id:2,tenant_id:tenant,role:'MONITORING'};
const grant={principal:admin,installationId,deviceId,employeeId:2,action:'GRANT',confirmation:'CONFIRM_GRANT_REPORT_ONLY'};
const revoke={...grant,action:'REVOKE',confirmation:'CONFIRM_REVOKE_REPORT_ONLY'};
const input={principal:employee,installationId,deviceId,requestId,categoryId:'TR-01',hazard:'NONE',consent:'SUBMIT_REPORT_ONLY'};
const active={binding_id:bindingId,installation_id:installationId,tenant_id:tenant,device_id:deviceId,employee_user_id:2,granted_by:1,state:'ACTIVE',revoked_by:null,revoked_at:null};
const revoked={...active,state:'REVOKED',revoked_by:1,revoked_at:new Date()};
const prior={incident_id:incidentId,installation_id:installationId,tenant_id:tenant,device_id:deviceId,actor_user_id:2,intake_request_id:requestId,category_id:'TR-01',hazard:'NONE',status:'OPEN'};
function fixture({bindings=[active],incidents=[],auditRows=[{id:incidentId}],owner={},user={},write=1,audit=1,commitFails=false}={}){
 const c={beginTransaction:vi.fn(),commit:vi.fn(async()=>{if(commitFails)throw Error('COMMIT_OUTCOME_UNKNOWN')}),rollback:vi.fn(),release:vi.fn(),destroy:vi.fn(),
 query:vi.fn(async(sql,params)=>{
  if(sql.includes('FROM devices'))return [[{id:deviceId,tenant_id:tenant,...owner}]];
  if(sql.includes('FROM users'))return [[{id:params[0],tenant_id:tenant,role:params[0]===1?'SUPER_ADMIN':'MONITORING',active:1,status:'ACTIVE',...user}]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM troubleshooting_employee_bindings'))return [bindings];
  if(sql.startsWith('SELECT')&&sql.includes('FROM troubleshooting_incidents'))return [incidents];
  if(sql.startsWith('SELECT')&&sql.includes('FROM audit_logs'))return [auditRows];
  if(sql.startsWith('INSERT INTO audit_logs'))return [{affectedRows:audit}];
  if(sql.startsWith('INSERT')||sql.startsWith('UPDATE'))return [{affectedRows:write}];
  throw Error('unexpected query');
 })};return {c,pool:{getConnection:vi.fn(async()=>c)}};
}
describe('employee report-only internal intake across existing issue catalog',()=>{
 for(const issue of troubleshootingCatalog){
  it(issue.id+' records scoped categorical report without diagnostic or repair permission',async()=>{
   const f=fixture(),r=await report(f.pool,{...input,categoryId:issue.id});
   expect(r).toMatchObject({category_id:issue.id,status:issue.repair_tier==='D3'?'ESCALATED':'OPEN',duplicate:false,consent_scope:'REPORT_ONLY',execution_authorized:false,diagnostic_authorized:false,repair_authorized:false,production_accepted:false});
   expect(f.c.commit).toHaveBeenCalledOnce();
   const writes=f.c.query.mock.calls.filter(([q])=>q.startsWith('INSERT'));
   expect(writes).toHaveLength(2);expect(writes[1][1]).toContain('TROUBLESHOOTING_EMPLOYEE_REPORT_RECORDED');
   expect(JSON.parse(writes[1][1][6])).toMatchObject({binding_id:bindingId,consent_scope:'REPORT_ONLY'});
  });
  it(issue.id+' denies unbound report even with explicit consent',async()=>{
   const f=fixture({bindings:[]});
   await expect(report(f.pool,{...input,categoryId:issue.id})).rejects.toThrow('EMPLOYEE_SCOPE_DENIED');
   expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);expect(f.c.rollback).toHaveBeenCalledOnce();
  });
 }
 for(const [i,consent] of [null,undefined,true,false,'','DIAGNOSTIC','SUBMIT_REPORT_ONLY\n',{},[]].entries())
  it('rejects invalid consent '+i,async()=>{
   const f=fixture();await expect(report(f.pool,{...input,consent})).rejects.toThrow('EMPLOYEE_REPORT_INVALID');expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
 it('requires current scope and persisted active employee role',async()=>{
  for(const options of [{owner:{tenant_id:'foreign'}},{user:{active:0}},{user:{role:'SUPER_ADMIN'}},{bindings:[revoked]},{bindings:[{...active,device_id:tenant}]},{bindings:[active,active]}]){
   const f=fixture(options);await expect(report(f.pool,input)).rejects.toThrow();expect(f.c.commit).not.toHaveBeenCalled();
  }
 });
 it('checks immutable replay receipt and rejects conflicting or unbound historic report',async()=>{
  const f=fixture({incidents:[prior]});expect(await report(f.pool,input)).toMatchObject({duplicate:true,incident_id:incidentId});
  expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);
  for(const opts of [{incidents:[prior],auditRows:[]},{incidents:[prior],auditRows:[{id:incidentId},{id:incidentId}]},{incidents:[{...prior,category_id:'TR-02'}]}]){
   const g=fixture(opts);await expect(report(g.pool,input)).rejects.toThrow();expect(g.c.commit).not.toHaveBeenCalled();
  }
 });
 it('does not persist report when audit or write cannot be confirmed',async()=>{
  for(const opts of [{write:0},{audit:0},{commitFails:true}]){
   const f=fixture(opts);await expect(report(f.pool,input)).rejects.toThrow();expect(f.c.rollback).toHaveBeenCalledOnce();
  }
 });
});
describe('employee binding administration',()=>{
 it('creates one explicit grant and audit, then returns existing binding without mutation',async()=>{
  const f=fixture({bindings:[]});expect(await change(f.pool,grant)).toMatchObject({state:'ACTIVE',duplicate:false,scope:'REPORT_ONLY'});
  expect(f.c.query.mock.calls.filter(([q])=>q.startsWith('INSERT'))).toHaveLength(2);
  const g=fixture();expect(await change(g.pool,grant)).toMatchObject({binding_id:bindingId,duplicate:true});
  expect(g.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);
 });
 it('revokes even when target employee is no longer active; does not reactivate tombstones',async()=>{
  const f=fixture();expect(await change(f.pool,revoke)).toMatchObject({state:'REVOKED',duplicate:false});
  expect(f.c.query.mock.calls.filter(([q])=>q.includes('FROM users'))).toHaveLength(1);
  const g=fixture({bindings:[revoked]});expect(await change(g.pool,revoke)).toMatchObject({duplicate:true,state:'REVOKED'});
  await expect(change(g.pool,grant)).rejects.toThrow('EMPLOYEE_BINDING_REGRANT_BLOCKED');
 });
 for(const [i,patch] of [{employeeId:1},{employeeId:0},{employeeId:'2'},{employeeId:2147483648},{action:'OTHER'},{confirmation:'CONFIRM_GRANT_REPORT_ONLY\n'},{principal:employee},{extra:true}].entries())
  it('rejects malformed binding administration '+i,async()=>{
   const f=fixture();await expect(change(f.pool,{...grant,...patch})).rejects.toThrow('EMPLOYEE_REPORT_INVALID');expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
 it('rolls back missing scope, invalid stored bindings or unconfirmed writes',async()=>{
  for(const opts of [{owner:{tenant_id:'other'}},{bindings:[{...active,revoked_by:1}]},{bindings:[active,active]},{bindings:[],write:0},{bindings:[],audit:0}]){
   const f=fixture(opts);await expect(change(f.pool,grant)).rejects.toThrow();expect(f.c.rollback).toHaveBeenCalledOnce();expect(f.c.commit).not.toHaveBeenCalled();
  }
 });
});
