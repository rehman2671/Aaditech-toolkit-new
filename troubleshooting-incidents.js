// Internal lab/technician intake only. Callers must obtain installation
// identity and authenticate the administrator independently. No HTTP routes,
// free text, consent record, endpoint collection or action execution.
import {randomUUID} from 'node:crypto';
import {validateInstallationIdentity} from './scripts/installation-identity.mjs';
import {planTroubleshooting,troubleshootingCatalog} from './troubleshooting-policy.js';
const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const fail=code=>{throw Error(code)};
const dbInt=x=>typeof x==='number'&&Number.isSafeInteger(x)?x:
 typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)&&String(Number(x))===x&&Number.isSafeInteger(Number(x))?Number(x):NaN;
function context(pool,input,fields){
 if(!pool?.getConnection||!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!fields.includes(k)))fail('INCIDENT_INVALID');
 const {principal,deviceId,installationId}=input;
 if(!principal||!Number.isSafeInteger(principal.id)||principal.id<1||
    principal.role!=='SUPER_ADMIN'||!uuid(principal.tenant_id)||!uuid(deviceId))fail('INCIDENT_INVALID');
 validateInstallationIdentity({schema_version:1,installation_id:installationId});
 return Object.freeze({installationId,deviceId,tenant:principal.tenant_id,actor:principal.id});
}
async function transaction(pool,fn){
 const c=await pool.getConnection();let done=false,discard=false,commitStarted=false;
 try{await c.beginTransaction();const result=await fn(c);commitStarted=true;await c.commit();done=true;return result;}
 finally{
  if(!done){if(commitStarted)discard=true;try{await c.rollback()}catch{discard=true}if(discard)c.destroy?.()}
  if(!discard)c.release()
 }
}
async function lockScope(c,s){
 const [devices]=await c.query('SELECT id,tenant_id FROM devices WHERE id=? AND tenant_id=? FOR UPDATE',[s.deviceId,s.tenant]);
 const d=devices?.length===1?devices[0]:null;
 if(!d||d.id!==s.deviceId||d.tenant_id!==s.tenant)fail('INCIDENT_SCOPE_DENIED');
 const [users]=await c.query('SELECT id,tenant_id,role,active,status FROM users WHERE id=? AND tenant_id=? FOR UPDATE',[s.actor,s.tenant]);
 const u=users?.length===1?users[0]:null;
 if(!u||dbInt(u.id)!==s.actor||u.tenant_id!==s.tenant||u.role!=='SUPER_ADMIN'||
    ![1,true,'1'].includes(u.active)||u.status!=='ACTIVE')fail('INCIDENT_SCOPE_DENIED');
}
const columns='incident_id,installation_id,tenant_id,device_id,actor_user_id,intake_request_id,category_id,hazard,status';
function view(row,s,duplicate){
 if(!row||row.installation_id!==s.installationId||row.tenant_id!==s.tenant||
    row.device_id!==s.deviceId||dbInt(row.actor_user_id)!==s.actor||!uuid(row.incident_id)||
    !uuid(row.intake_request_id)||!['OPEN','ESCALATED'].includes(row.status))fail('INCIDENT_SCOPE_DENIED');
 const plan=planTroubleshooting({category_id:row.category_id,intake_channel:'TECHNICIAN',hazard:row.hazard});
 if(plan.reason==='INVALID_INPUT'||row.status!==(plan.decision==='HUMAN_ONLY'?'ESCALATED':'OPEN'))fail('INCIDENT_STATE_INVALID');
 return Object.freeze({incident_id:row.incident_id,category_id:row.category_id,status:row.status,
   duplicate,diagnostic_authorized:false,repair_authorized:false,production_accepted:false});
}
export async function createTroubleshootingIncident(pool,input){
 const s=context(pool,input,['principal','installationId','deviceId','requestId','categoryId','hazard']);
 const {requestId,categoryId,hazard='UNKNOWN'}=input;
 if(!uuid(requestId))fail('INCIDENT_INVALID');
 const plan=planTroubleshooting({category_id:categoryId,intake_channel:'TECHNICIAN',hazard});
 if(plan.reason==='INVALID_INPUT')fail('INCIDENT_INVALID');
 const status=plan.decision==='HUMAN_ONLY'?'ESCALATED':'OPEN';
 return transaction(pool,async c=>{
  await lockScope(c,s);
  const [rows]=await c.query('SELECT '+columns+' FROM troubleshooting_incidents WHERE installation_id=? AND tenant_id=? AND actor_user_id=? AND intake_request_id=? FOR UPDATE',
    [s.installationId,s.tenant,s.actor,requestId]);
  if(!Array.isArray(rows)||rows.length>1)fail('INCIDENT_STATE_INVALID');
  if(rows.length){
   const row=rows[0];
   if(row.device_id!==s.deviceId||row.category_id!==categoryId||row.hazard!==hazard)fail('INCIDENT_IDEMPOTENCY_CONFLICT');
   if(row.intake_request_id!==requestId)fail('INCIDENT_STATE_INVALID');
   return view(row,s,true);
  }
  const id=randomUUID();
  const [r]=await c.query('INSERT INTO troubleshooting_incidents (incident_id,installation_id,tenant_id,device_id,actor_user_id,intake_request_id,category_id,hazard,status) VALUES (?,?,?,?,?,?,?,?,?)',
    [id,s.installationId,s.tenant,s.deviceId,s.actor,requestId,categoryId,hazard,status]);
  if(r?.affectedRows!==1)fail('INCIDENT_WRITE_UNCONFIRMED');
  const [a]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',
    [randomUUID(),s.tenant,s.actor,String(s.actor),'TROUBLESHOOTING_INCIDENT_RECORDED','Incident:'+id,JSON.stringify({category_id:categoryId,status}),null]);
  if(a?.affectedRows!==1)fail('INCIDENT_AUDIT_UNCONFIRMED');
  return view({incident_id:id,installation_id:s.installationId,tenant_id:s.tenant,device_id:s.deviceId,
    actor_user_id:s.actor,intake_request_id:requestId,category_id:categoryId,hazard,status},s,false);
 });
}
export async function inspectTroubleshootingIncident(pool,input){
 const s=context(pool,input,['principal','installationId','deviceId','incidentId']);
 const {incidentId}=input;
 if(!uuid(incidentId))fail('INCIDENT_INVALID');
 return transaction(pool,async c=>{
  await lockScope(c,s);
  const [rows]=await c.query('SELECT '+columns+' FROM troubleshooting_incidents WHERE incident_id=? AND installation_id=? AND tenant_id=? AND device_id=? AND actor_user_id=? FOR UPDATE',
   [incidentId,s.installationId,s.tenant,s.deviceId,s.actor]);
  if(rows?.length!==1||rows[0].incident_id!==incidentId)fail('INCIDENT_NOT_FOUND');
  return view(rows[0],s,false);
 });
}

// Planning only: no caller-selected command, arguments, consent or approval.
// Unknown hazards and escalated incidents cannot produce diagnostic plans.
export async function recordDiagnosticPlan(pool,input){
 const s=context(pool,input,['principal','installationId','deviceId','incidentId','requestId']);
 const {incidentId,requestId}=input;
 if(!uuid(incidentId)||!uuid(requestId))fail('INCIDENT_INVALID');
 return transaction(pool,async c=>{
  await lockScope(c,s);
  const [incidents]=await c.query('SELECT '+columns+' FROM troubleshooting_incidents WHERE incident_id=? AND installation_id=? AND tenant_id=? AND device_id=? AND actor_user_id=? FOR UPDATE',
   [incidentId,s.installationId,s.tenant,s.deviceId,s.actor]);
  if(incidents?.length!==1||incidents[0].incident_id!==incidentId)fail('INCIDENT_NOT_FOUND');
  const incident=incidents[0];view(incident,s,false);
  const diagnostic=troubleshootingCatalog.find(x=>x.id===incident.category_id)?.diagnostic_id;
  if(incident.status!=='OPEN'||incident.hazard!=='NONE'||!diagnostic)fail('DIAGNOSTIC_PLAN_BLOCKED');
  const [rows]=await c.query('SELECT * FROM troubleshooting_diagnostic_plans WHERE incident_id=? AND request_id=? FOR UPDATE',[incidentId,requestId]);
  if(!Array.isArray(rows)||rows.length>1)fail('DIAGNOSTIC_PLAN_STATE_INVALID');
  const result=(id,duplicate)=>Object.freeze({plan_id:id,incident_id:incidentId,diagnostic_id:diagnostic,
    status:'PLANNED_ONLY',duplicate,diagnostic_authorized:false,execution_authorized:false,
    repair_authorized:false,production_accepted:false});
  if(rows.length){
   const row=rows[0];
   if(!uuid(row.plan_id)||row.incident_id!==incidentId||row.request_id!==requestId||
      row.installation_id!==s.installationId||row.tenant_id!==s.tenant||row.device_id!==s.deviceId||
      dbInt(row.actor_user_id)!==s.actor||row.diagnostic_id!==diagnostic)fail('DIAGNOSTIC_PLAN_STATE_INVALID');
   return result(row.plan_id,true);
  }
  const id=randomUUID();
  const [r]=await c.query('INSERT INTO troubleshooting_diagnostic_plans (plan_id,incident_id,installation_id,tenant_id,device_id,actor_user_id,request_id,diagnostic_id) VALUES (?,?,?,?,?,?,?,?)',
   [id,incidentId,s.installationId,s.tenant,s.deviceId,s.actor,requestId,diagnostic]);
  if(r?.affectedRows!==1)fail('DIAGNOSTIC_PLAN_WRITE_UNCONFIRMED');
  const [a]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',
   [randomUUID(),s.tenant,s.actor,String(s.actor),'TROUBLESHOOTING_DIAGNOSTIC_PLANNED','Incident:'+incidentId,
    JSON.stringify({plan_id:id,diagnostic_id:diagnostic}),null]);
  if(a?.affectedRows!==1)fail('INCIDENT_AUDIT_UNCONFIRMED');
  return result(id,false);
 });
}

// Scope-limited reporting for the same currently active technician and device.
// An absent execution/outcome integration is explicitly unmeasured, not zero.
export async function summarizeTroubleshootingIntake(pool,input){
 const s=context(pool,input,['principal','installationId','deviceId']);
 return transaction(pool,async c=>{
  await lockScope(c,s);
  const [rows]=await c.query(
   "SELECT COUNT(*) AS reported, COALESCE(SUM(i.status='OPEN'),0) AS open_count, COALESCE(SUM(i.status='ESCALATED'),0) AS escalated_count, COALESCE(SUM(EXISTS(SELECT 1 FROM troubleshooting_diagnostic_plans p WHERE p.incident_id=i.incident_id AND p.installation_id=i.installation_id AND p.tenant_id=i.tenant_id AND p.device_id=i.device_id AND p.actor_user_id=i.actor_user_id)),0) AS planned_incidents FROM troubleshooting_incidents i WHERE i.installation_id=? AND i.tenant_id=? AND i.device_id=? AND i.actor_user_id=?",
   [s.installationId,s.tenant,s.deviceId,s.actor]);
  if(rows?.length!==1)fail('INCIDENT_SUMMARY_UNVERIFIED');
  const parseCount=x=>{
   const n=dbInt(x);if(!Number.isSafeInteger(n)||n<0)fail('INCIDENT_SUMMARY_UNVERIFIED');return n;
  };
  const reported=parseCount(rows[0].reported),open=parseCount(rows[0].open_count),
    escalated=parseCount(rows[0].escalated_count),planned=parseCount(rows[0].planned_incidents);
  if(!Number.isSafeInteger(open+escalated)||open+escalated!==reported||planned>open)fail('INCIDENT_SUMMARY_UNVERIFIED');
  return Object.freeze({reported,open,escalated,incidents_with_plans:planned,
   diagnosed:null,executed_attempts:null,verified_resolved:null,resolution_rate:null,
   outcome_measurement:'NOT_IMPLEMENTED',production_accepted:false});
 });
}
