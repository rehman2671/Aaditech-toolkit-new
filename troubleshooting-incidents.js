// Internal lab/technician intake only. Callers must obtain installation
// identity and authenticate the administrator independently. No HTTP routes,
// free text, consent record, endpoint collection or action execution.
import {randomUUID} from 'node:crypto';
import {validateInstallationIdentity} from './scripts/installation-identity.mjs';
import {planTroubleshooting,troubleshootingCatalog} from './troubleshooting-policy.js';
import {classifyDeviceObservation} from './device-observations.js';
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
  return recordScopedIntake(c,s,{requestId,categoryId,hazard,status});
 });
}
async function recordScopedIntake(c,s,{requestId,categoryId,hazard,status,bindingId=null,observationSignal=null}){
  const [rows]=await c.query('SELECT '+columns+' FROM troubleshooting_incidents WHERE installation_id=? AND tenant_id=? AND actor_user_id=? AND intake_request_id=? FOR UPDATE',
    [s.installationId,s.tenant,s.actor,requestId]);
  if(!Array.isArray(rows)||rows.length>1)fail('INCIDENT_STATE_INVALID');
  if(rows.length){
   const row=rows[0];
   if(row.device_id!==s.deviceId||row.category_id!==categoryId||row.hazard!==hazard)fail('INCIDENT_IDEMPOTENCY_CONFLICT');
   if(row.intake_request_id!==requestId)fail('INCIDENT_STATE_INVALID');
   if(bindingId){
    const [audit]=await c.query("SELECT id FROM audit_logs WHERE tenant_id=? AND actor_id=? AND action='TROUBLESHOOTING_EMPLOYEE_REPORT_RECORDED' AND target_resource=? AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.binding_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.consent_scope'))='REPORT_ONLY'",[s.tenant,String(s.actor),'Incident:'+row.incident_id,bindingId]);
    if(!Array.isArray(audit)||audit.length!==1||!uuid(audit[0]?.id))fail('EMPLOYEE_REPORT_REPLAY_UNVERIFIED');
   }
   if(observationSignal){
    const [audit]=await c.query("SELECT id FROM audit_logs WHERE tenant_id=? AND actor_id=? AND action='TROUBLESHOOTING_OBSERVATION_INCIDENT_RECORDED' AND target_resource=? AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.observation_signal'))=?",[s.tenant,String(s.actor),'Incident:'+row.incident_id,observationSignal]);
    if(!Array.isArray(audit)||audit.length!==1||!uuid(audit[0]?.id))fail('OBSERVATION_REPLAY_UNVERIFIED');
   }
   return view(row,s,true);
  }
  if(observationSignal){
   const [observed]=await c.query('SELECT id,tenant_id,hostname,status,agent_token_revoked,cpu_usage,memory_usage,disk_free_gb,disk_total_gb,TIMESTAMPDIFF(SECOND,telemetry_reported_at,NOW(3)) AS telemetry_age_seconds FROM devices WHERE id=? AND tenant_id=? FOR UPDATE',[s.deviceId,s.tenant]);
   if(observed?.length!==1||observed[0].id!==s.deviceId||!classifyDeviceObservation(observed[0],s.tenant).signals.includes(observationSignal))fail('OBSERVATION_NOT_CURRENT');
  }
  const id=randomUUID();
  const [r]=await c.query('INSERT INTO troubleshooting_incidents (incident_id,installation_id,tenant_id,device_id,actor_user_id,intake_request_id,category_id,hazard,status) VALUES (?,?,?,?,?,?,?,?,?)',
    [id,s.installationId,s.tenant,s.deviceId,s.actor,requestId,categoryId,hazard,status]);
  if(r?.affectedRows!==1)fail('INCIDENT_WRITE_UNCONFIRMED');
  const [a]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',
    [randomUUID(),s.tenant,s.actor,String(s.actor),bindingId?'TROUBLESHOOTING_EMPLOYEE_REPORT_RECORDED':observationSignal?'TROUBLESHOOTING_OBSERVATION_INCIDENT_RECORDED':'TROUBLESHOOTING_INCIDENT_RECORDED','Incident:'+id,JSON.stringify({category_id:categoryId,status,...(bindingId?{binding_id:bindingId,consent_scope:'REPORT_ONLY'}:{}),...(observationSignal?{observation_signal:observationSignal,source:'HUMAN_CONFIRMED_TELEMETRY_OBSERVATION'}:{})}),null]);
  if(a?.affectedRows!==1)fail('INCIDENT_AUDIT_UNCONFIRMED');
  return view({incident_id:id,installation_id:s.installationId,tenant_id:s.tenant,device_id:s.deviceId,
    actor_user_id:s.actor,intake_request_id:requestId,category_id:categoryId,hazard,status},s,false);
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
 const s=context(pool,input,['principal','installationId','deviceId','from','until']);
 const window=reportingWindow(input);
 if(window){
  const report=await summarizeTroubleshootingCategories(pool,{principal:{id:s.actor,tenant_id:s.tenant,role:'SUPER_ADMIN'},installationId:s.installationId,deviceId:s.deviceId,...window});
  const {totals,period,clock_basis,plan_count_basis,diagnosed,executed_attempts,verified_resolved,resolution_rate,outcome_measurement,production_accepted}=report;
  return Object.freeze({...totals,period,window,clock_basis,plan_count_basis,diagnosed,executed_attempts,verified_resolved,resolution_rate,outcome_measurement,production_accepted});
 }
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

// Internal scoped plan inspection. No employee route, artifact acceptance,
// execution or status transition. Re-derive catalog and current scope.
export async function inspectDiagnosticPlan(pool,input){
 const s=context(pool,input,['principal','installationId','deviceId','incidentId','planId']);
 const {incidentId,planId}=input;
 if(!uuid(incidentId)||!uuid(planId))fail('INCIDENT_INVALID');
 return transaction(pool,async c=>{
  await lockScope(c,s);
  const [incidents]=await c.query('SELECT '+columns+' FROM troubleshooting_incidents WHERE incident_id=? AND installation_id=? AND tenant_id=? AND device_id=? AND actor_user_id=? FOR UPDATE',
   [incidentId,s.installationId,s.tenant,s.deviceId,s.actor]);
  if(incidents?.length!==1||incidents[0].incident_id!==incidentId)fail('INCIDENT_NOT_FOUND');
  const incident=incidents[0];view(incident,s,false);
  const diagnostic=troubleshootingCatalog.find(x=>x.id===incident.category_id)?.diagnostic_id;
  if(incident.status!=='OPEN'||incident.hazard!=='NONE'||!diagnostic)fail('DIAGNOSTIC_PLAN_BLOCKED');
  const [rows]=await c.query('SELECT * FROM troubleshooting_diagnostic_plans WHERE plan_id=? AND incident_id=? AND installation_id=? AND tenant_id=? AND device_id=? AND actor_user_id=? FOR UPDATE',
   [planId,incidentId,s.installationId,s.tenant,s.deviceId,s.actor]);
  if(!Array.isArray(rows)||rows.length!==1)fail('DIAGNOSTIC_PLAN_NOT_FOUND');
  const row=rows[0];
  if(!row||row.plan_id!==planId||row.incident_id!==incidentId||!uuid(row.request_id)||
     row.installation_id!==s.installationId||row.tenant_id!==s.tenant||row.device_id!==s.deviceId||
     dbInt(row.actor_user_id)!==s.actor||row.diagnostic_id!==diagnostic)fail('DIAGNOSTIC_PLAN_STATE_INVALID');
  return Object.freeze({plan_id:planId,incident_id:incidentId,diagnostic_id:diagnostic,status:'PLANNED_ONLY',
   diagnostic_authorized:false,execution_authorized:false,repair_authorized:false,production_accepted:false});
 });
}

// Scope-limited category breakdown. Only intake and distinct planned incident
// counts are measured. A single grouped query, with explicit invalid-state
// count, keeps denominators consistent. No external report exposure.
// Database wall-clock DATETIME(3) bounds, not browser-local or UTC conversion.
// Half-open cohorts; no plan created outside the cohort's observation cutoff.
function reportingWindow(input){
 if(!Object.hasOwn(input,'from')&&!Object.hasOwn(input,'until'))return null;
 const parse=x=>{
  if(typeof x!=='string'||x.length!==23||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(x)||x.slice(0,4)<'1000')fail('INCIDENT_REPORT_WINDOW_INVALID');
  const iso=x.replace(' ','T')+'Z',ms=Date.parse(iso);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==iso)fail('INCIDENT_REPORT_WINDOW_INVALID');
  return ms;
 };
 const {from,until}=input,start=parse(from),end=parse(until);
 if(end<=start||end-start>31*86400000)fail('INCIDENT_REPORT_WINDOW_INVALID');
 return Object.freeze({from,until});
}
export async function summarizeTroubleshootingCategories(pool,input){
 const s=context(pool,input,['principal','installationId','deviceId','from','until']);
 const window=reportingWindow(input);
 return transaction(pool,async c=>{
  await lockScope(c,s);
  const cutoff=window?' AND p.created_at>=i.opened_at AND p.created_at<?':'';
  const cohort=window?' AND i.opened_at>=? AND i.opened_at<?':'';
  const params=window?[window.until,s.installationId,s.tenant,s.deviceId,s.actor,window.from,window.until]:[s.installationId,s.tenant,s.deviceId,s.actor];
  const [rows]=await c.query(
   "SELECT i.category_id, i.hazard, i.status, COUNT(*) AS reported, COALESCE(SUM(EXISTS(SELECT 1 FROM troubleshooting_diagnostic_plans p WHERE p.incident_id=i.incident_id AND p.installation_id=i.installation_id AND p.tenant_id=i.tenant_id AND p.device_id=i.device_id AND p.actor_user_id=i.actor_user_id"+cutoff+")),0) AS planned_incidents FROM troubleshooting_incidents i WHERE i.installation_id=? AND i.tenant_id=? AND i.device_id=? AND i.actor_user_id=?"+cohort+" GROUP BY i.category_id,i.hazard,i.status",
   params);
  if(!Array.isArray(rows)||rows.length>156)fail('INCIDENT_CATEGORY_REPORT_UNVERIFIED');
  const buckets=new Map(troubleshootingCatalog.map(x=>[x.id,{category_id:x.id,reported:0,open:0,escalated:0,incidents_with_plans:0}]));
  const seen=new Set();
  const count=x=>{const n=dbInt(x);if(!Number.isSafeInteger(n)||n<0)fail('INCIDENT_CATEGORY_REPORT_UNVERIFIED');return n};
  const add=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))fail('INCIDENT_CATEGORY_REPORT_UNVERIFIED');return n};
  for(const row of rows){
   if(!row||!buckets.has(row.category_id))fail('INCIDENT_CATEGORY_REPORT_UNVERIFIED');
   const p=planTroubleshooting({category_id:row.category_id,intake_channel:'TECHNICIAN',hazard:row.hazard});
   if(p.reason==='INVALID_INPUT'||!['NONE','UNKNOWN','PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE'].includes(row.hazard)||
      row.status!==(p.decision==='HUMAN_ONLY'?'ESCALATED':'OPEN'))fail('INCIDENT_CATEGORY_REPORT_UNVERIFIED');
   const key=JSON.stringify([row.category_id,row.hazard,row.status]);
   if(seen.has(key))fail('INCIDENT_CATEGORY_REPORT_UNVERIFIED');seen.add(key);
   const reported=count(row.reported),planned=count(row.planned_incidents);
   if(reported===0||planned>reported||(row.status!=='OPEN'||row.hazard!=='NONE')&&planned!==0)fail('INCIDENT_CATEGORY_REPORT_UNVERIFIED');
   const b=buckets.get(row.category_id);
   b.reported=add(b.reported,reported);
   const field=row.status==='OPEN'?'open':'escalated';b[field]=add(b[field],reported);
   b.incidents_with_plans=add(b.incidents_with_plans,planned);
  }
  const categories=Object.freeze([...buckets.values()].map(x=>Object.freeze(x)));
  const totals=Object.freeze(Object.fromEntries(['reported','open','escalated','incidents_with_plans'].map(k=>[k,categories.reduce((n,x)=>add(n,x[k]),0)])));
  return Object.freeze({categories,totals,scope:'CURRENT_TECHNICIAN_DEVICE',period:window?'OPENED_IN_WINDOW':'ALL_RECORDED',
   ...(window?{window,clock_basis:'DATABASE_WALL_CLOCK_DATETIME',plan_count_basis:'CREATED_AT_OR_AFTER_OPEN_AND_BEFORE_UNTIL'}:{}),
   diagnosed:null,executed_attempts:null,verified_resolved:null,resolution_rate:null,
   outcome_measurement:'NOT_IMPLEMENTED',production_accepted:false});
 });
}


// Internal service only. The caller must authenticate the principal and
// independently establish installation identity. No public route, device
// enrollment, remote execution, diagnostic consent, or role provisioning.
function employeeContext(pool,input,keys,role){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||
    Reflect.ownKeys(input).length!==keys.length||!keys.every(k=>Object.hasOwn(input,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(input,k),'value')))
  fail('EMPLOYEE_REPORT_INVALID');
 const {principal,installationId,deviceId}=input;
 if(!pool?.getConnection||!principal||principal.role!==role||!Number.isSafeInteger(principal.id)||principal.id<1||
    principal.id>2147483647||!uuid(principal.tenant_id)||!uuid(deviceId))fail('EMPLOYEE_REPORT_INVALID');
 validateInstallationIdentity({schema_version:1,installation_id:installationId});
 return Object.freeze({installationId,deviceId,tenant:principal.tenant_id,actor:principal.id});
}
async function employeeDeviceLock(c,s){
 const [rows]=await c.query('SELECT id,tenant_id FROM devices WHERE id=? AND tenant_id=? FOR UPDATE',[s.deviceId,s.tenant]);
 if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==s.deviceId||rows[0]?.tenant_id!==s.tenant)fail('EMPLOYEE_SCOPE_DENIED');
}
async function employeeUserLock(c,s,id,role){
 const [rows]=await c.query('SELECT id,tenant_id,role,active,status FROM users WHERE id=? AND tenant_id=? FOR UPDATE',[id,s.tenant]);
 const u=Array.isArray(rows)&&rows.length===1?rows[0]:null;
 if(!u||dbInt(u.id)!==id||u.tenant_id!==s.tenant||u.role!==role||![1,true,'1'].includes(u.active)||u.status!=='ACTIVE')
  fail('EMPLOYEE_SCOPE_DENIED');
}
const bindingColumns='binding_id,installation_id,tenant_id,device_id,employee_user_id,granted_by,state,revoked_by,revoked_at';
async function bindingLock(c,s,employeeId){
 const [rows]=await c.query('SELECT '+bindingColumns+' FROM troubleshooting_employee_bindings WHERE installation_id=? AND tenant_id=? AND device_id=? AND employee_user_id=? FOR UPDATE',[s.installationId,s.tenant,s.deviceId,employeeId]);
 if(!Array.isArray(rows)||rows.length>1)fail('EMPLOYEE_BINDING_UNVERIFIED');
 if(!rows.length)return null;
 const r=rows[0];
 const validUser=x=>Number.isSafeInteger(dbInt(x))&&dbInt(x)>0&&dbInt(x)<=2147483647;
 if(!r||!uuid(r.binding_id)||r.installation_id!==s.installationId||r.tenant_id!==s.tenant||r.device_id!==s.deviceId||
    dbInt(r.employee_user_id)!==employeeId||!validUser(r.granted_by)||dbInt(r.granted_by)===employeeId||
    !['ACTIVE','REVOKED'].includes(r.state)||
    (r.state==='ACTIVE'?(r.revoked_by!==null||r.revoked_at!==null):(!validUser(r.revoked_by)||dbInt(r.revoked_by)===employeeId||r.revoked_at==null)))fail('EMPLOYEE_BINDING_UNVERIFIED');
 return r;
}
async function employeeAudit(c,s,action,bindingId,employeeId){
 const [a]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',
  [randomUUID(),s.tenant,s.actor,String(s.actor),action,'EmployeeBinding:'+bindingId,JSON.stringify({employee_user_id:employeeId,scope:'REPORT_ONLY'}),null]);
 if(a?.affectedRows!==1)fail('EMPLOYEE_BINDING_AUDIT_UNCONFIRMED');
}
export async function changeEmployeeReportBinding(pool,input){
 const s=employeeContext(pool,input,['principal','installationId','deviceId','employeeId','action','confirmation'],'SUPER_ADMIN');
 const {employeeId,action,confirmation}=input;
 if(!Number.isSafeInteger(employeeId)||employeeId<1||employeeId>2147483647||employeeId===s.actor||
    !['GRANT','REVOKE'].includes(action)||confirmation!==('CONFIRM_'+action+'_REPORT_ONLY'))fail('EMPLOYEE_REPORT_INVALID');
 return transaction(pool,async c=>{
  await employeeDeviceLock(c,s);
  // Consistent lock order across grant/revoke; grant requires active target.
  // Revocation must remain possible after employee disablement or deletion.
  if(action==='GRANT'){
   for(const id of [s.actor,employeeId].sort((a,b)=>a-b))await employeeUserLock(c,s,id,id===s.actor?'SUPER_ADMIN':'MONITORING');
  }else await employeeUserLock(c,s,s.actor,'SUPER_ADMIN');
  const row=await bindingLock(c,s,employeeId);
  const result=(binding_id,state,duplicate)=>Object.freeze({binding_id,state,duplicate,scope:'REPORT_ONLY',
   diagnostic_authorized:false,repair_authorized:false,production_accepted:false});
  if(action==='GRANT'){
   if(row){
    if(row.state!=='ACTIVE')fail('EMPLOYEE_BINDING_REGRANT_BLOCKED');
    return result(row.binding_id,row.state,true);
   }
   const id=randomUUID();
   const [w]=await c.query("INSERT INTO troubleshooting_employee_bindings (binding_id,installation_id,tenant_id,device_id,employee_user_id,granted_by,state) VALUES (?,?,?,?,?,?,'ACTIVE')",[id,s.installationId,s.tenant,s.deviceId,employeeId,s.actor]);
   if(w?.affectedRows!==1)fail('EMPLOYEE_BINDING_WRITE_UNCONFIRMED');
   await employeeAudit(c,s,'TROUBLESHOOTING_EMPLOYEE_BINDING_GRANTED',id,employeeId);
   return result(id,'ACTIVE',false);
  }
  if(!row)fail('EMPLOYEE_BINDING_NOT_FOUND');
  if(row.state==='REVOKED')return result(row.binding_id,'REVOKED',true);
  const [w]=await c.query("UPDATE troubleshooting_employee_bindings SET state='REVOKED',revoked_by=?,revoked_at=NOW(3) WHERE binding_id=? AND installation_id=? AND tenant_id=? AND device_id=? AND employee_user_id=? AND state='ACTIVE'",[s.actor,row.binding_id,s.installationId,s.tenant,s.deviceId,employeeId]);
  if(w?.affectedRows!==1)fail('EMPLOYEE_BINDING_WRITE_UNCONFIRMED');
  await employeeAudit(c,s,'TROUBLESHOOTING_EMPLOYEE_BINDING_REVOKED',row.binding_id,employeeId);
  return result(row.binding_id,'REVOKED',false);
 });
}
export async function createEmployeeTroubleshootingReport(pool,input){
 const s=employeeContext(pool,input,['principal','installationId','deviceId','requestId','categoryId','hazard','consent'],'MONITORING');
 const {requestId,categoryId,hazard,consent}=input;
 if(!uuid(requestId)||consent!=='SUBMIT_REPORT_ONLY')fail('EMPLOYEE_REPORT_INVALID');
 const plan=planTroubleshooting({category_id:categoryId,intake_channel:'SELF_SERVICE',hazard});
 if(plan.reason==='INVALID_INPUT')fail('EMPLOYEE_REPORT_INVALID');
 const status=plan.decision==='HUMAN_ONLY'?'ESCALATED':'OPEN';
 return transaction(pool,async c=>{
  await employeeDeviceLock(c,s);
  await employeeUserLock(c,s,s.actor,'MONITORING');
  const row=await bindingLock(c,s,s.actor);
  if(row?.state!=='ACTIVE')fail('EMPLOYEE_SCOPE_DENIED');
  const recorded=await recordScopedIntake(c,s,{requestId,categoryId,hazard,status,bindingId:row.binding_id});
  return Object.freeze({...recorded,consent_scope:'REPORT_ONLY',execution_authorized:false});
 });
}

// Manual technician intake from a current observation. No automatic incident
// creation, no claim of diagnosis, and hazard remains UNKNOWN until assessed.
const observationCategories=Object.freeze({HIGH_CPU_OBSERVATION:'TR-01',HIGH_MEMORY_OBSERVATION:'TR-01',LOW_DISK_OBSERVATION:'TR-04'});
export async function createObservationIncident(pool,input){
 const s=context(pool,input,['principal','installationId','deviceId','requestId','signal','confirmation']);
 if(!uuid(input.requestId)||!Object.hasOwn(observationCategories,input.signal)||input.confirmation!=='CONFIRM_OBSERVATION_REPORT_ONLY')fail('INCIDENT_INVALID');
 return transaction(pool,async c=>{
  await lockScope(c,s);
  const r=await recordScopedIntake(c,s,{requestId:input.requestId,categoryId:observationCategories[input.signal],hazard:'UNKNOWN',status:'OPEN',observationSignal:input.signal});
  return {...r,observation_signal:input.signal,measurement_truth_verified:false,diagnostic_authorized:false,repair_authorized:false};
 });
}
