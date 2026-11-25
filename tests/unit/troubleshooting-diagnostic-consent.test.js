import {describe,it,expect,vi} from 'vitest';
import {inspectConsent,changeConsent,inspectConsentReviewPlan,recordConsentReviewPlan} from '../../troubleshooting-diagnostic-consent.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const tenant=id(1),installationId=id(2),deviceId=id(3),incidentId=id(4),requestId=id(5);
const admin={id:1,role:'SUPER_ADMIN',tenant_id:tenant},employee={id:2,role:'MONITORING',tenant_id:tenant};
const inc={incident_id:incidentId,installation_id:installationId,tenant_id:tenant,device_id:deviceId,actor_user_id:2,category_id:'TR-01',hazard:'NONE',status:'OPEN'};
const base={installationId,deviceId,incidentId};
const row={consent_id:id(6),installation_id:installationId,tenant_id:tenant,device_id:deviceId,incident_id:incidentId,employee_user_id:2,requester_id:1,diagnostic_id:'RESOURCE_PRESSURE',state:'REQUESTED',revision:1,expired:0};
function fixture({existing=null,incident=inc,bound=true,events=[],write=1,plans=[],planAudit=[]}={}){
 let stored=existing;const c={beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),destroy:vi.fn(),query:vi.fn(async(q,p)=>{
  if(q.includes('FROM users'))return [[{id:p[0],tenant_id:tenant,role:p[0]===1?'SUPER_ADMIN':'MONITORING',active:1,status:'ACTIVE'}]];
  if(q.includes('FROM devices'))return [[{id:deviceId,tenant_id:tenant}]];
  if(q.includes('FROM troubleshooting_incidents'))return [[incident]];
  if(q.includes('FROM troubleshooting_employee_bindings'))return [bound?[{binding_id:id(7)}]:[]];
  if(q.includes('FROM troubleshooting_diagnostic_plans'))return [plans];
  if(q.includes('FROM audit_logs'))return [planAudit];
  if(q.includes('FROM troubleshooting_diagnostic_consent_events'))return [events];
  if(q.includes('FROM troubleshooting_diagnostic_consent'))return [stored?[stored]:[]];
  if(q.startsWith('INSERT INTO troubleshooting_diagnostic_consent ('))stored={...row,consent_id:p[0],state:p[8],revision:p[9]};
  if(q.startsWith('UPDATE troubleshooting_diagnostic_consent'))stored={...stored,state:p[0],revision:p[1],...(q.includes('DATE_ADD')?{expired:0,requester_id:p[2]}:{})};
  if(q.startsWith('INSERT')||q.startsWith('UPDATE'))return [{affectedRows:write}];
  throw Error(q)
 })};return {c,pool:{getConnection:async()=>c}};
}
const input=(action,expectedRevision,principal=action==='REQUEST'?admin:employee)=>({...base,principal,action,expectedRevision,requestId,confirmation:'CONFIRM_'+action+'_DIAGNOSTIC_REVIEW_ONLY'});
describe('separate diagnostic consent',()=>{
 it('reports no prior consent and derives diagnostic category',async()=>{const f=fixture();expect(await inspectConsent(f.pool,{...base,principal:employee})).toMatchObject({state:'NOT_REQUESTED',diagnostic_id:'RESOURCE_PRESSURE',execution_authorized:false})});
 it('records admin request plus event and audit',async()=>{const f=fixture();expect(await changeConsent(f.pool,input('REQUEST',0))).toMatchObject({state:'REQUESTED',revision:1,repair_authorized:false});expect(f.c.query.mock.calls.filter(([q])=>q.startsWith('INSERT'))).toHaveLength(3);expect(f.c.commit).toHaveBeenCalledOnce()});
 for(const [action,next] of [['GRANT','GRANTED'],['DENY','DENIED']])it('employee '+action,async()=>{const f=fixture({existing:row});expect(await changeConsent(f.pool,input(action,1))).toMatchObject({state:next,revision:2,diagnostic_authorized:false})});
 it('revokes granted consent even after expiry',async()=>{const f=fixture({existing:{...row,state:'GRANTED',revision:2,expired:1}});expect(await changeConsent(f.pool,input('REVOKE',2))).toMatchObject({state:'REVOKED',expired:true})});
 it('rejects wrong actor, stale revision, expired grant, and revoked assignment',async()=>{for(const [f,i] of [[fixture({existing:row}),input('GRANT',1,admin)],[fixture({existing:row}),input('GRANT',0)],[fixture({existing:{...row,expired:1}}),input('GRANT',1)],[fixture({existing:row,bound:false}),input('GRANT',1)]]){await expect(changeConsent(f.pool,i)).rejects.toThrow();expect(f.c.commit).not.toHaveBeenCalled()}});
 it('blocks hazards, D3 and foreign scope',async()=>{for(const i of [{...inc,hazard:'UNKNOWN'},{...inc,category_id:'TR-24',status:'ESCALATED'},{...inc,tenant_id:id(9)}])await expect(inspectConsent(fixture({incident:i}).pool,{...base,principal:employee})).rejects.toThrow()});
 it('returns exact prior event without duplicate writes; rejects changed action',async()=>{const f=fixture({existing:{...row,state:'GRANTED',revision:2},events:[{event_id:id(8),actor_user_id:2,request_id:requestId,action:'GRANT',revision:2}]});expect(await changeConsent(f.pool,input('GRANT',1))).toMatchObject({duplicate:true,event_id:id(8)});expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);await expect(changeConsent(f.pool,input('DENY',1))).rejects.toThrow('CONSENT_CONFLICT')});
 it('rolls back unconfirmed persistence',async()=>{const f=fixture({write:0});await expect(changeConsent(f.pool,input('REQUEST',0))).rejects.toThrow();expect(f.c.rollback).toHaveBeenCalledOnce();expect(f.c.commit).not.toHaveBeenCalled()});
});

describe('consent-bound review plan',()=>{
 const grant={...row,state:'GRANTED',revision:2};
 const p={...base,principal:admin,requestId,expectedConsentRevision:2,confirmation:'CONFIRM_REVIEW_PLAN_ONLY'};
 it('creates an audited catalog-derived plan only under current grant',async()=>{
  const f=fixture({existing:grant});expect(await inspectConsentReviewPlan(f.pool,p)).toMatchObject({state:'NOT_PLANNED',execution_authorized:false});
  expect(await recordConsentReviewPlan(f.pool,p)).toMatchObject({state:'PLANNED_ONLY',consent_revision:2,execution_authorized:false,repair_authorized:false});
  expect(f.c.query.mock.calls.filter(([q])=>q.startsWith('INSERT'))).toHaveLength(2);
 });
 it('denies revoked, expired, stale or employee requests',async()=>{
  for(const [existing,patch] of [[{...grant,state:'REVOKED'},{}],[{...grant,expired:1},{}],[grant,{expectedConsentRevision:1}],[grant,{principal:employee}]]){
   const f=fixture({existing});await expect(recordConsentReviewPlan(f.pool,{...p,...patch})).rejects.toThrow();expect(f.c.commit).not.toHaveBeenCalled();
  }
 });
 it('replays only same request and trusted consent audit, rejects preexisting unbound plan',async()=>{
  const plan={plan_id:id(10),incident_id:incidentId,installation_id:installationId,tenant_id:tenant,device_id:deviceId,actor_user_id:1,request_id:requestId,diagnostic_id:'RESOURCE_PRESSURE'};
  const f=fixture({existing:grant,plans:[plan],planAudit:[{id:id(11)}]});expect(await recordConsentReviewPlan(f.pool,p)).toMatchObject({duplicate:true,plan_id:plan.plan_id});
  await expect(recordConsentReviewPlan(f.pool,{...p,requestId:id(12)})).rejects.toThrow('CONSENT_PLAN_CONFLICT');
  await expect(recordConsentReviewPlan(fixture({existing:grant,plans:[plan]}).pool,p)).rejects.toThrow('CONSENT_PLAN_CONFLICT');
 });
});

describe('expired unanswered review request renewal',()=>{
 const expired={...row,expired:1};
 it('admin sees eligible renewal without granting execution',async()=>{const f=fixture({existing:expired});expect(await inspectConsent(f.pool,{...base,principal:admin})).toMatchObject({renewal_available:true,execution_authorized:false});expect(await inspectConsent(f.pool,{...base,principal:employee})).toMatchObject({renewal_available:false})});
 it('renews same consent with new revision, deadline, event and audit',async()=>{const f=fixture({existing:expired});expect(await changeConsent(f.pool,input('REQUEST',1))).toMatchObject({consent_id:row.consent_id,state:'REQUESTED',revision:2,expired:false,renewal_available:false,execution_authorized:false});expect(f.c.query.mock.calls.filter(([q])=>q.startsWith('UPDATE')&&q.includes('DATE_ADD'))).toHaveLength(1);expect(f.c.query.mock.calls.filter(([q])=>q.startsWith('INSERT'))).toHaveLength(2)});
 it.each(['DENIED','REVOKED','GRANTED'])('never overrides %s',async state=>{const f=fixture({existing:{...expired,state}});await expect(changeConsent(f.pool,input('REQUEST',1))).rejects.toThrow('CONSENT_CONFLICT');expect(f.c.commit).not.toHaveBeenCalled()});
 it('blocks unexpired, stale revision, employee, missing assignment, second renewal and prior plan',async()=>{for(const [f,i] of [[fixture({existing:row}),input('REQUEST',1)],[fixture({existing:expired}),input('REQUEST',0)],[fixture({existing:expired}),input('REQUEST',1,employee)],[fixture({existing:expired,bound:false}),input('REQUEST',1)],[fixture({existing:{...expired,revision:2}}),input('REQUEST',2)],[fixture({existing:expired,plans:[{plan_id:id(9)}]}),input('REQUEST',1)]]){await expect(changeConsent(f.pool,i)).rejects.toThrow();expect(f.c.commit).not.toHaveBeenCalled()}});
 it('replays exact renewal request without extending the deadline again',async()=>{const f=fixture({existing:{...row,revision:2},events:[{event_id:id(8),actor_user_id:1,request_id:requestId,action:'REQUEST',revision:2}]});expect(await changeConsent(f.pool,input('REQUEST',1))).toMatchObject({duplicate:true,revision:2,event_id:id(8)});expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true)});
 it('blocks stale employee grant from original revision after renewal',async()=>{const f=fixture({existing:{...row,revision:2}});await expect(changeConsent(f.pool,input('GRANT',1))).rejects.toThrow('CONSENT_CONFLICT');expect(f.c.commit).not.toHaveBeenCalled()});
});
