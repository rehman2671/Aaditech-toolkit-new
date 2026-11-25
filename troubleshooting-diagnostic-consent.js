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
export async function inspectConsent(pool,input){
 const role=input.principal?.role;
 if(!['SUPER_ADMIN','MONITORING'].includes(role))fail('CONSENT_SCOPE_DENIED');
 const s=scope(input,role);
 return transaction(pool,async c=>{await activeUser(c,s,s.actor,role);const i=await incident(c,s,input),r=await load(c,i);
 return r?project(r,s,i):{incident_id:i.incident_id,device_id:i.device_id,diagnostic_id:i.diagnostic,state:'NOT_REQUESTED',revision:0,expired:false,scope:'REVIEW_ONLY',diagnostic_authorized:false,execution_authorized:false,repair_authorized:false,production_accepted:false}});
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
    return {...current,duplicate:true,event_id:e.event_id};
   }
  }
  if(action==='REQUEST'?(current!==null||expectedRevision!==0):(!current||current.revision!==expectedRevision||((action==='REVOKE')?current.state!=='GRANTED':current.expired||current.state!=='REQUESTED')))fail('CONSENT_CONFLICT');
  const consentId=current?.consent_id??randomUUID(),eventId=randomUUID(),revision=expectedRevision+1;
  const [w]=current?await c.query('UPDATE troubleshooting_diagnostic_consent SET state=?,revision=? WHERE consent_id=? AND revision=?',[next,revision,consentId,expectedRevision]):await c.query("INSERT INTO troubleshooting_diagnostic_consent (consent_id,installation_id,tenant_id,device_id,incident_id,employee_user_id,requester_id,diagnostic_id,state,revision,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(3), INTERVAL 24 HOUR))",[consentId,s.installation,s.tenant,i.device_id,i.incident_id,n(i.actor_user_id),s.actor,i.diagnostic,next,revision]);
  if(w?.affectedRows!==1)fail('CONSENT_WRITE_UNCONFIRMED');
  const [event]=await c.query('INSERT INTO troubleshooting_diagnostic_consent_events (event_id,consent_id,actor_user_id,request_id,action,revision) VALUES (?,?,?,?,?,?)',[eventId,consentId,s.actor,requestId,action,revision]);
  if(event?.affectedRows!==1)fail('CONSENT_WRITE_UNCONFIRMED');
  const [audit]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',[randomUUID(),s.tenant,s.actor,String(s.actor),'TROUBLESHOOTING_DIAGNOSTIC_REVIEW_CONSENT_'+action,'Incident:'+i.incident_id,JSON.stringify({consent_id:consentId,event_id:eventId,revision,scope:'REVIEW_ONLY'}),null]);
  if(audit?.affectedRows!==1)fail('CONSENT_WRITE_UNCONFIRMED');
  const result=project(await load(c,i),s,i);
  if(result.state!==next||result.revision!==revision||result.consent_id!==consentId)fail('CONSENT_WRITE_UNCONFIRMED');
  return {...result,event_id:eventId,duplicate:false};
 });
}
