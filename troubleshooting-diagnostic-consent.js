// Consent permits review planning only. No collection, command, repair, or
// proof of endpoint ownership. Current assignment and persisted role required.
import {randomUUID} from 'node:crypto';
import {troubleshootingCatalog} from './troubleshooting-policy.js';
const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const id=x=>Number.isSafeInteger(x)&&x>0&&x<=2147483647;
const n=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)?Number(x):x;
const fail=c=>{throw Error(c)};
async function transaction(pool,fn){
 const c=await pool.getConnection();let done=false,discard=false,committing=false;
 try{await c.beginTransaction();const r=await fn(c);committing=true;await c.commit();done=true;return r}
 finally{if(!done){if(committing)discard=true;try{await c.rollback()}catch{discard=true}}if(discard)c.destroy();else c.release()}
}
function scope(input,role){
 const p=input?.principal;
 if(!p||p.role!==role||!id(p.id)||!uuid(p.tenant_id)||!uuid(input.installationId))fail('CONSENT_SCOPE_DENIED');
 return {actor:p.id,tenant:p.tenant_id,installation:input.installationId,role};
}
async function activeUser(c,s,actor,role){
 const [rows]=await c.query('SELECT id,tenant_id,role,active,status FROM users WHERE id=? AND tenant_id=? FOR SHARE',[actor,s.tenant]);
 const u=rows?.length===1?rows[0]:null;
 if(!u||n(u.id)!==actor||u.tenant_id!==s.tenant||u.role!==role||![1,true,'1'].includes(u.active)||u.status!=='ACTIVE')fail('CONSENT_SCOPE_DENIED');
}
async function incident(c,s,input){
 const {incidentId,deviceId}=input;
 if(!uuid(incidentId)||!uuid(deviceId))fail('CONSENT_INVALID');
 const [devices]=await c.query('SELECT id,tenant_id FROM devices WHERE id=? AND tenant_id=? FOR SHARE',[deviceId,s.tenant]);
 if(devices?.length!==1||devices[0].id!==deviceId||devices[0].tenant_id!==s.tenant)fail('CONSENT_SCOPE_DENIED');
 const [rows]=await c.query('SELECT incident_id,installation_id,tenant_id,device_id,actor_user_id,category_id,hazard,status FROM troubleshooting_incidents WHERE incident_id=? AND installation_id=? AND tenant_id=? AND device_id=? FOR UPDATE',[incidentId,s.installation,s.tenant,deviceId]);
 const r=rows?.length===1?rows[0]:null;
 if(!r||r.incident_id!==incidentId||r.installation_id!==s.installation||r.tenant_id!==s.tenant||r.device_id!==deviceId||!id(n(r.actor_user_id))||(s.role==='MONITORING'&&n(r.actor_user_id)!==s.actor))fail('CONSENT_SCOPE_DENIED');
 const diagnostic=troubleshootingCatalog.find(x=>x.id===r.category_id)?.diagnostic_id;
 if(!diagnostic||r.status!=='OPEN'||r.hazard!=='NONE')fail('CONSENT_NOT_ELIGIBLE');
 await activeUser(c,s,n(r.actor_user_id),'MONITORING');
 const [bindings]=await c.query("SELECT binding_id FROM troubleshooting_employee_bindings WHERE installation_id=? AND tenant_id=? AND device_id=? AND employee_user_id=? AND state='ACTIVE' FOR SHARE",[s.installation,s.tenant,deviceId,n(r.actor_user_id)]);
 if(bindings?.length!==1||!uuid(bindings[0].binding_id))fail('CONSENT_SCOPE_DENIED');
 return {...r,diagnostic};
}
function project(row,s,i){
 if(!row||!uuid(row.consent_id)||row.installation_id!==s.installation||row.tenant_id!==s.tenant||row.device_id!==i.device_id||row.incident_id!==i.incident_id||n(row.employee_user_id)!==n(i.actor_user_id)||row.diagnostic_id!==i.diagnostic||!id(n(row.requester_id))||!id(n(row.revision))||!['REQUESTED','GRANTED','DENIED','REVOKED'].includes(row.state)||![0,1].includes(n(row.expired)))fail('CONSENT_STATE_INVALID');
 return {consent_id:row.consent_id,incident_id:i.incident_id,device_id:i.device_id,diagnostic_id:i.diagnostic,state:row.state,revision:n(row.revision),expired:n(row.expired)===1,scope:'REVIEW_ONLY',diagnostic_authorized:false,execution_authorized:false,repair_authorized:false,production_accepted:false};
}
async function load(c,i){
 const [rows]=await c.query('SELECT *, (expires_at<=NOW(3)) AS expired FROM troubleshooting_diagnostic_consent WHERE incident_id=? FOR UPDATE',[i.incident_id]);
 if(!Array.isArray(rows)||rows.length>1)fail('CONSENT_STATE_INVALID');return rows[0]??null;
}
const actions={GRANT:'GRANTED',DENY:'DENIED',REVOKE:'REVOKED'};
// One renewal maximum; only an unanswered expired request, never a decision.
async function renewalAvailable(c,i,current){
 if(!current||current.state!=='REQUESTED'||!current.expired||current.revision!==1)return false;
 const [plans]=await c.query('SELECT plan_id FROM troubleshooting_diagnostic_plans WHERE incident_id=? LIMIT 1 FOR UPDATE',[i.incident_id]);
 if(!Array.isArray(plans)||plans.length>1)fail('CONSENT_STATE_INVALID');
 return plans.length===0;
}
async function consentReceipt(c,s,i,row){
 const current=project(row,s,i);
 return {...current,renewal_available:s.role==='SUPER_ADMIN'&&await renewalAvailable(c,i,current)};
}
export async function inspectConsent(pool,input){
 const role=input.principal?.role;
 if(!['SUPER_ADMIN','MONITORING'].includes(role))fail('CONSENT_SCOPE_DENIED');
 const s=scope(input,role);
 return transaction(pool,async c=>{await activeUser(c,s,s.actor,role);const i=await incident(c,s,input),r=await load(c,i);
 return r?consentReceipt(c,s,i,r):{renewal_available:false,incident_id:i.incident_id,device_id:i.device_id,diagnostic_id:i.diagnostic,state:'NOT_REQUESTED',revision:0,expired:false,scope:'REVIEW_ONLY',diagnostic_authorized:false,execution_authorized:false,repair_authorized:false,production_accepted:false}});
}
export async function changeConsent(pool,input){
 const {action,requestId,expectedRevision,confirmation}=input;
 if(!['REQUEST','GRANT','DENY','REVOKE'].includes(action)||!uuid(requestId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=2147483647||confirmation!=='CONFIRM_'+action+'_DIAGNOSTIC_REVIEW_ONLY')fail('CONSENT_INVALID');
 const role=action==='REQUEST'?'SUPER_ADMIN':'MONITORING',s=scope(input,role);
 return transaction(pool,async c=>{
  await activeUser(c,s,s.actor,role);const i=await incident(c,s,input),r=await load(c,i);
  const current=r?project(r,s,i):null;
  const next=action==='REQUEST'?'REQUESTED':actions[action];
  if(current){
   const [events]=await c.query('SELECT event_id,actor_user_id,action,revision,request_id FROM troubleshooting_diagnostic_consent_events WHERE consent_id=? AND request_id=? FOR UPDATE',[current.consent_id,requestId]);
   if(!Array.isArray(events)||events.length>1)fail('CONSENT_STATE_INVALID');
   if(events.length){
    const e=events[0];if(!uuid(e.event_id)||n(e.actor_user_id)!==s.actor||e.action!==action||e.request_id!==requestId||n(e.revision)!==expectedRevision+1||n(e.revision)>current.revision)fail('CONSENT_CONFLICT');
    return {...await consentReceipt(c,s,i,r),duplicate:true,event_id:e.event_id};
   }
  }
  const renewing=action==='REQUEST'&&current!==null;
  if(action==='REQUEST'?(renewing?(current.revision!==expectedRevision||!await renewalAvailable(c,i,current)):expectedRevision!==0):(!current||current.revision!==expectedRevision||((action==='REVOKE')?current.state!=='GRANTED':current.expired||current.state!=='REQUESTED')))fail('CONSENT_CONFLICT');
  const consentId=current?.consent_id??randomUUID(),eventId=randomUUID(),revision=expectedRevision+1;
  const [w]=renewing?await c.query("UPDATE troubleshooting_diagnostic_consent SET state=?,revision=?,requester_id=?,expires_at=DATE_ADD(NOW(3), INTERVAL 24 HOUR) WHERE consent_id=? AND revision=? AND state='REQUESTED' AND expires_at<=NOW(3)",[next,revision,s.actor,consentId,expectedRevision]):current?await c.query('UPDATE troubleshooting_diagnostic_consent SET state=?,revision=? WHERE consent_id=? AND revision=?',[next,revision,consentId,expectedRevision]):await c.query("INSERT INTO troubleshooting_diagnostic_consent (consent_id,installation_id,tenant_id,device_id,incident_id,employee_user_id,requester_id,diagnostic_id,state,revision,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(3), INTERVAL 24 HOUR))",[consentId,s.installation,s.tenant,i.device_id,i.incident_id,n(i.actor_user_id),s.actor,i.diagnostic,next,revision]);
  if(w?.affectedRows!==1)fail('CONSENT_WRITE_UNCONFIRMED');
  const [event]=await c.query('INSERT INTO troubleshooting_diagnostic_consent_events (event_id,consent_id,actor_user_id,request_id,action,revision) VALUES (?,?,?,?,?,?)',[eventId,consentId,s.actor,requestId,action,revision]);
  if(event?.affectedRows!==1)fail('CONSENT_WRITE_UNCONFIRMED');
  const [audit]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',[randomUUID(),s.tenant,s.actor,String(s.actor),'TROUBLESHOOTING_DIAGNOSTIC_REVIEW_CONSENT_'+action,'Incident:'+i.incident_id,JSON.stringify({consent_id:consentId,event_id:eventId,revision,renewed_expired_request:renewing,scope:'REVIEW_ONLY'}),null]);
  if(audit?.affectedRows!==1)fail('CONSENT_WRITE_UNCONFIRMED');
  const result=await consentReceipt(c,s,i,await load(c,i));
  if(result.state!==next||result.revision!==revision||result.consent_id!==consentId||(action==='REQUEST'&&result.expired))fail('CONSENT_WRITE_UNCONFIRMED');
  return {...result,event_id:eventId,duplicate:false};
 });
}

// Review-only diagnostic plan bound to the employee's current recorded
// consent and independent catalog. No collector, dispatch or signing key.
async function currentReviewPlan(c,s,i,consent){
 const [rows]=await c.query('SELECT plan_id,incident_id,installation_id,tenant_id,device_id,actor_user_id,request_id,diagnostic_id FROM troubleshooting_diagnostic_plans WHERE incident_id=? ORDER BY plan_id LIMIT 2 FOR UPDATE',[i.incident_id]);
 if(!Array.isArray(rows)||rows.length>1)fail('CONSENT_PLAN_CONFLICT');
 if(!rows.length)return null;
 const r=rows[0];
 if(!uuid(r.plan_id)||!uuid(r.request_id)||r.incident_id!==i.incident_id||r.installation_id!==s.installation||r.tenant_id!==s.tenant||r.device_id!==i.device_id||r.diagnostic_id!==i.diagnostic||!id(n(r.actor_user_id)))fail('CONSENT_STATE_INVALID');
 const [audit]=await c.query("SELECT id FROM audit_logs WHERE tenant_id=? AND actor_id=? AND action='TROUBLESHOOTING_CONSENT_REVIEW_PLAN_RECORDED' AND target_resource=? AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.plan_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.consent_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.consent_revision'))=?",[s.tenant,String(n(r.actor_user_id)),'Incident:'+i.incident_id,r.plan_id,consent.consent_id,String(consent.revision)]);
 if(audit?.length!==1||!uuid(audit[0].id))fail('CONSENT_PLAN_CONFLICT');
 return r;
}
const planReceipt=(i,consent,r,duplicate=false)=>({incident_id:i.incident_id,device_id:i.device_id,diagnostic_id:i.diagnostic,consent_id:consent.consent_id,consent_revision:consent.revision,plan_id:r?.plan_id??null,state:r?'PLANNED_ONLY':'NOT_PLANNED',duplicate,diagnostic_authorized:false,execution_authorized:false,repair_authorized:false,production_accepted:false});
async function withGrantedConsent(pool,input,operation){
 const s=scope(input,'SUPER_ADMIN');
 return transaction(pool,async c=>{
  await activeUser(c,s,s.actor,'SUPER_ADMIN');const i=await incident(c,s,input),raw=await load(c,i);
  const consent=raw?project(raw,s,i):null;
  if(!consent||consent.state!=='GRANTED'||consent.expired)fail('CONSENT_PLAN_CONFLICT');
  const prior=await currentReviewPlan(c,s,i,consent);
  return operation(c,s,i,consent,prior);
 });
}
export async function inspectConsentReviewPlan(pool,input){
 return withGrantedConsent(pool,input,async(c,s,i,consent,prior)=>planReceipt(i,consent,prior));
}
export async function recordConsentReviewPlan(pool,input){
 if(!uuid(input.requestId)||!id(input.expectedConsentRevision)||input.confirmation!=='CONFIRM_REVIEW_PLAN_ONLY')fail('CONSENT_INVALID');
 return withGrantedConsent(pool,input,async(c,s,i,consent,prior)=>{
  if(consent.revision!==input.expectedConsentRevision)fail('CONSENT_PLAN_CONFLICT');
  if(prior){
   if(prior.request_id!==input.requestId||n(prior.actor_user_id)!==s.actor)fail('CONSENT_PLAN_CONFLICT');
   return planReceipt(i,consent,prior,true);
  }
  const planId=randomUUID();
  const [w]=await c.query('INSERT INTO troubleshooting_diagnostic_plans (plan_id,incident_id,installation_id,tenant_id,device_id,actor_user_id,request_id,diagnostic_id) VALUES (?,?,?,?,?,?,?,?)',[planId,i.incident_id,s.installation,s.tenant,i.device_id,s.actor,input.requestId,i.diagnostic]);
  if(w?.affectedRows!==1)fail('CONSENT_WRITE_UNCONFIRMED');
  const [audit]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',[randomUUID(),s.tenant,s.actor,String(s.actor),'TROUBLESHOOTING_CONSENT_REVIEW_PLAN_RECORDED','Incident:'+i.incident_id,JSON.stringify({plan_id:planId,consent_id:consent.consent_id,consent_revision:consent.revision,scope:'REVIEW_ONLY'}),null]);
  if(audit?.affectedRows!==1)fail('CONSENT_WRITE_UNCONFIRMED');
  // Expiry check at the point of completion, still under consent row lock.
  const current=project(await load(c,i),s,i);
  if(current.expired||current.state!=='GRANTED'||current.revision!==consent.revision)fail('CONSENT_PLAN_CONFLICT');
  return planReceipt(i,consent,{plan_id:planId});
 });
}
