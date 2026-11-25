// One-time human screening of UNKNOWN intake, not an authorization or proof
// that the device is safe. Original hazard/status remain immutable.
import {randomUUID} from 'node:crypto';
import {troubleshootingCatalog} from './troubleshooting-policy.js';
const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const hazards=['NONE','PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE'];
const id=x=>Number.isSafeInteger(x)&&x>0&&x<=2147483647;
const n=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)?Number(x):x;
const fail=x=>{throw Error(x)};
export function projectHazardAssessment(r,i){
 if(!r)return {assessment_id:null,assessment_state:'NOT_RECORDED',assessment:null,human_referral_required:i.status==='ESCALATED',safety_verified:false,diagnostic_authorized:false,repair_authorized:false};
 if(!uuid(r.assessment_id)||!uuid(r.request_id)||r.incident_id!==i.incident_id||r.installation_id!==i.installation_id||r.tenant_id!==i.tenant_id||r.device_id!==i.device_id||!id(n(r.actor_user_id))||!hazards.includes(r.assessment)||i.hazard!=='UNKNOWN'||i.status!=='OPEN'||!troubleshootingCatalog.some(x=>x.id===i.category_id&&x.repair_tier!=='D3'))fail('HAZARD_STATE_INVALID');
 return {assessment_id:r.assessment_id,assessment_state:'RECORDED',assessment:r.assessment,human_referral_required:r.assessment!=='NONE',safety_verified:false,diagnostic_authorized:false,repair_authorized:false};
}
async function tx(pool,fn){const c=await pool.getConnection();let done=false,discard=false,committing=false;try{await c.beginTransaction();const r=await fn(c);committing=true;await c.commit();done=true;return r}finally{if(!done){if(committing)discard=true;try{await c.rollback()}catch{discard=true}}if(discard)c.destroy();else c.release()}}
async function scoped(c,input){
 const p=input.principal;
 if(!p||p.role!=='SUPER_ADMIN'||!id(p.id)||![p.tenant_id,input.installationId,input.incidentId,input.deviceId].every(uuid))fail('HAZARD_SCOPE_DENIED');
 const [u]=await c.query('SELECT id,tenant_id,role,active,status FROM users WHERE id=? AND tenant_id=? FOR SHARE',[p.id,p.tenant_id]);
 if(u?.length!==1||n(u[0].id)!==p.id||u[0].tenant_id!==p.tenant_id||u[0].role!=='SUPER_ADMIN'||![1,true,'1'].includes(u[0].active)||u[0].status!=='ACTIVE')fail('HAZARD_SCOPE_DENIED');
 const [d]=await c.query('SELECT id FROM devices WHERE id=? AND tenant_id=? FOR SHARE',[input.deviceId,p.tenant_id]);
 if(d?.length!==1||d[0].id!==input.deviceId)fail('HAZARD_SCOPE_DENIED');
 const [rows]=await c.query('SELECT incident_id,installation_id,tenant_id,device_id,category_id,hazard,status FROM troubleshooting_incidents WHERE incident_id=? AND installation_id=? AND tenant_id=? AND device_id=? FOR UPDATE',[input.incidentId,input.installationId,p.tenant_id,input.deviceId]);
 const i=rows?.length===1?rows[0]:null;
 if(!i||i.incident_id!==input.incidentId||i.installation_id!==input.installationId||i.tenant_id!==p.tenant_id||i.device_id!==input.deviceId)fail('HAZARD_SCOPE_DENIED');
 if(i.status!=='OPEN'||i.hazard!=='UNKNOWN'||!troubleshootingCatalog.some(x=>x.id===i.category_id&&x.repair_tier!=='D3'))fail('HAZARD_NOT_ELIGIBLE');
 const [a]=await c.query('SELECT * FROM troubleshooting_hazard_assessments WHERE incident_id=? FOR UPDATE',[i.incident_id]);
 if(!Array.isArray(a)||a.length>1)fail('HAZARD_STATE_INVALID');
 return {p,i,row:a[0]??null};
}
export async function inspectHazardAssessment(pool,input){
 return tx(pool,async c=>{const {i,row}=await scoped(c,input);return {incident_id:i.incident_id,device_id:i.device_id,...projectHazardAssessment(row,i),production_accepted:false}});
}
export async function recordHazardAssessment(pool,input){
 if(!uuid(input.requestId)||!hazards.includes(input.assessment)||input.confirmation!=='CONFIRM_HUMAN_HAZARD_SCREENING_ONLY')fail('HAZARD_INVALID');
 return tx(pool,async c=>{
  const {p,i,row}=await scoped(c,input);
  const receipt=(r,duplicate)=>({incident_id:i.incident_id,device_id:i.device_id,...projectHazardAssessment(r,i),duplicate,production_accepted:false});
  if(row){const prior=receipt(row,true);if(row.request_id!==input.requestId||n(row.actor_user_id)!==p.id||row.assessment!==input.assessment)fail('HAZARD_CONFLICT');return prior}
  const [replay]=await c.query('SELECT incident_id FROM troubleshooting_hazard_assessments WHERE installation_id=? AND tenant_id=? AND actor_user_id=? AND request_id=? FOR UPDATE',[i.installation_id,i.tenant_id,p.id,input.requestId]);
  if(!Array.isArray(replay)||replay.length)fail('HAZARD_CONFLICT');
  const assessmentId=randomUUID(),r={assessment_id:assessmentId,incident_id:i.incident_id,installation_id:i.installation_id,tenant_id:i.tenant_id,device_id:i.device_id,actor_user_id:p.id,request_id:input.requestId,assessment:input.assessment};
  const [w]=await c.query('INSERT INTO troubleshooting_hazard_assessments (incident_id,assessment_id,installation_id,tenant_id,device_id,actor_user_id,request_id,assessment) VALUES (?,?,?,?,?,?,?,?)',[i.incident_id,assessmentId,i.installation_id,i.tenant_id,i.device_id,p.id,input.requestId,input.assessment]);
  if(w?.affectedRows!==1)fail('HAZARD_WRITE_UNCONFIRMED');
  const [audit]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',[randomUUID(),i.tenant_id,p.id,String(p.id),'TROUBLESHOOTING_HAZARD_SCREENING_RECORDED','Incident:'+i.incident_id,JSON.stringify({assessment_id:assessmentId,assessment:input.assessment,scope:'HUMAN_SCREENING_ONLY'}),null]);
  if(audit?.affectedRows!==1)fail('HAZARD_WRITE_UNCONFIRMED');
  return receipt(r,false);
 });
}
