// Tenant-scoped human review, distinct from diagnosis, repair and resolution.
import {randomUUID} from 'node:crypto';
import {planTroubleshooting,troubleshootingCatalog} from './troubleshooting-policy.js';
import {projectHazardAssessment} from './troubleshooting-hazard-assessment.js';
const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const integer=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0&&x<=2147483647;
const number=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)?Number(x):x;
const fail=code=>{throw Error(code)};
const states=Object.freeze(['UNREVIEWED','IN_REVIEW','AWAITING_USER','REFERRED','REOPENED']);
const graph=Object.freeze({UNREVIEWED:['IN_REVIEW','REFERRED'],IN_REVIEW:['AWAITING_USER','REFERRED'],AWAITING_USER:['IN_REVIEW','REFERRED'],REFERRED:['REOPENED'],REOPENED:['IN_REVIEW','REFERRED']});
export function allowedReviewTransitions(state,intakeStatus,screeningReferral=false){
 if(!states.includes(state)||!['OPEN','ESCALATED'].includes(intakeStatus))fail('REVIEW_INVALID');
 // Escalation remains visible and never becomes an ordinary local resolution.
 return Object.freeze(graph[state].filter(x=>(intakeStatus==='OPEN'||x!=='AWAITING_USER')&&(!screeningReferral||x==='REFERRED')));
}
function scope(pool,input,role){
 const p=input?.principal;
 if(!pool?.getConnection||!p||p.role!==role||!integer(p.id)||p.id===0||!uuid(p.tenant_id)||!uuid(input.installationId))fail('REVIEW_SCOPE_DENIED');
 return {actor:p.id,tenant:p.tenant_id,installation:input.installationId,role};
}
async function tx(pool,fn){
 const c=await pool.getConnection();let done=false,discard=false,committing=false;
 try{await c.beginTransaction();const result=await fn(c);committing=true;await c.commit();done=true;return result}
 finally{if(!done){if(committing)discard=true;try{await c.rollback()}catch{discard=true}}if(discard)c.destroy();else c.release()}
}
async function user(c,s){
 const [rows]=await c.query('SELECT id,tenant_id,role,active,status FROM users WHERE id=? AND tenant_id=? FOR SHARE',[s.actor,s.tenant]);
 const u=rows?.length===1?rows[0]:null;
 if(!u||number(u.id)!==s.actor||u.tenant_id!==s.tenant||u.role!==s.role||![true,1,'1'].includes(u.active)||u.status!=='ACTIVE')fail('REVIEW_SCOPE_DENIED');
}
function project(r,s){
 if(!r||r.installation_id!==s.installation||r.tenant_id!==s.tenant||!uuid(r.incident_id)||!uuid(r.device_id)||!integer(number(r.actor_user_id))||number(r.actor_user_id)===0)fail('REVIEW_STATE_INVALID');
 const plan=planTroubleshooting({category_id:r.category_id,intake_channel:'TECHNICIAN',hazard:r.hazard});
 if(plan.reason==='INVALID_INPUT'||r.status!==(plan.decision==='HUMAN_ONLY'?'ESCALATED':'OPEN'))fail('REVIEW_STATE_INVALID');
 const state=r.review_state??'UNREVIEWED',revision=number(r.revision??0);
 if(!states.includes(state)||!integer(revision)||(state==='UNREVIEWED')!==(revision===0))fail('REVIEW_STATE_INVALID');
 const hazardAssessment=projectHazardAssessment(r.assessment_id?{assessment_id:r.assessment_id,incident_id:r.assessment_incident_id,installation_id:r.assessment_installation_id,tenant_id:r.assessment_tenant_id,device_id:r.assessment_device_id,actor_user_id:r.assessment_actor_id,request_id:r.assessment_request_id,assessment:r.assessment}:null,r);
 const screeningReferral=hazardAssessment.assessment_state==='RECORDED'&&hazardAssessment.human_referral_required;
 return {incident_id:r.incident_id,device_id:r.device_id,category_id:r.category_id,hazard:r.hazard,intake_status:r.status,review_state:state,revision,
  hazard_assessment:hazardAssessment,qualified_referral_pending:screeningReferral&&state!=='REFERRED',qualified_referral_recorded:screeningReferral&&state==='REFERRED',
  allowed_transitions:allowedReviewTransitions(state,r.status,screeningReferral),diagnostic_authorized:false,repair_authorized:false,verified_resolved:false};
}
const select="SELECT i.incident_id,i.installation_id,i.tenant_id,i.device_id,i.actor_user_id,i.category_id,i.hazard,i.status,r.review_state,r.revision,h.assessment_id,h.incident_id AS assessment_incident_id,h.installation_id AS assessment_installation_id,h.tenant_id AS assessment_tenant_id,h.device_id AS assessment_device_id,h.actor_user_id AS assessment_actor_id,h.request_id AS assessment_request_id,h.assessment FROM troubleshooting_incidents i LEFT JOIN troubleshooting_incident_reviews r ON r.incident_id=i.incident_id AND r.installation_id=i.installation_id AND r.tenant_id=i.tenant_id AND r.device_id=i.device_id LEFT JOIN troubleshooting_hazard_assessments h ON h.incident_id=i.incident_id JOIN devices d ON d.id=i.device_id AND d.tenant_id=i.tenant_id WHERE i.installation_id=? AND i.tenant_id=?";
export async function listIncidentReviews(pool,input){
 const s=scope(pool,input,'SUPER_ADMIN');
 const {after='',category='',status='',deviceId=''}=input;
 if((after!==''&&!uuid(after))||(deviceId!==''&&!uuid(deviceId))||(category!==''&&!troubleshootingCatalog.some(x=>x.id===category))||!['','OPEN','ESCALATED'].includes(status))fail('REVIEW_INVALID');
 return tx(pool,async c=>{
  await user(c,s);
  let sql=select;const params=[s.installation,s.tenant];
  for(const [field,val] of [['i.device_id',deviceId],['i.category_id',category],['i.status',status]])if(val){sql+=' AND '+field+'=?';params.push(val)}
  if(after){sql+=' AND i.incident_id>?';params.push(after)}
  const [rows]=await c.query(sql+' ORDER BY i.incident_id LIMIT 51',params);
  if(!Array.isArray(rows)||rows.length>51||new Set(rows.map(r=>r.incident_id)).size!==rows.length)fail('REVIEW_STATE_INVALID');
  const items=rows.slice(0,50).map(r=>project(r,s));
  return {items,next_cursor:rows.length===51?items.at(-1).incident_id:null,scope:'CURRENT_PRIMARY_TENANT',verified_resolution_available:false,production_accepted:false};
 });
}
export async function listEmployeeIncidentReviews(pool,input){
 const s=scope(pool,input,'MONITORING'),after=input.after??'';
 if(after!==''&&!uuid(after))fail('REVIEW_INVALID');
 return tx(pool,async c=>{
  await user(c,s);
  const [rows]=await c.query(select+" AND i.actor_user_id=? AND EXISTS(SELECT 1 FROM troubleshooting_employee_bindings b WHERE b.installation_id=i.installation_id AND b.tenant_id=i.tenant_id AND b.device_id=i.device_id AND b.employee_user_id=i.actor_user_id AND b.state='ACTIVE')"+(after?' AND i.incident_id>?':'')+' ORDER BY i.incident_id LIMIT 51',[s.installation,s.tenant,s.actor,...(after?[after]:[])]);
  if(!Array.isArray(rows)||rows.length>51||rows.some(r=>number(r.actor_user_id)!==s.actor)||new Set(rows.map(r=>r.incident_id)).size!==rows.length)fail('REVIEW_STATE_INVALID');
  const items=rows.slice(0,50).map(r=>{const {allowed_transitions,...view}=project(r,s);return view});
  return {items,next_cursor:rows.length===51?items.at(-1).incident_id:null,scope:'OWN_ACTIVE_ASSIGNMENTS',verified_resolution_available:false};
 });
}
export async function transitionIncidentReview(pool,input){
 const s=scope(pool,input,'SUPER_ADMIN');
 const {incidentId,deviceId,requestId,expectedRevision,nextState,confirmation}=input;
 if(![incidentId,deviceId,requestId].every(uuid)||!integer(expectedRevision)||expectedRevision>=2147483647||!states.slice(1).includes(nextState)||confirmation!=='CONFIRM_HUMAN_REVIEW_ONLY')fail('REVIEW_INVALID');
 return tx(pool,async c=>{
  await user(c,s);
  // Lock incident before review row/event lookup. Employee intake is never changed.
  const [inc]=await c.query('SELECT incident_id,installation_id,tenant_id,device_id,actor_user_id,category_id,hazard,status FROM troubleshooting_incidents WHERE installation_id=? AND tenant_id=? AND device_id=? AND incident_id=? FOR UPDATE',[s.installation,s.tenant,deviceId,incidentId]);
  if(inc?.length!==1||inc[0].incident_id!==incidentId||inc[0].device_id!==deviceId)fail('REVIEW_NOT_FOUND');
  const [devices]=await c.query('SELECT id FROM devices WHERE id=? AND tenant_id=? FOR SHARE',[deviceId,s.tenant]);
  if(devices?.length!==1||devices[0].id!==deviceId)fail('REVIEW_NOT_FOUND');
  const [rows]=await c.query('SELECT * FROM troubleshooting_incident_reviews WHERE incident_id=? FOR UPDATE',[incidentId]);
  if(!Array.isArray(rows)||rows.length>1)fail('REVIEW_STATE_INVALID');
  const row=rows[0];
  if(row&&(row.incident_id!==incidentId||row.installation_id!==s.installation||row.tenant_id!==s.tenant||row.device_id!==deviceId||!states.slice(1).includes(row.review_state)))fail('REVIEW_STATE_INVALID');
  // Same incident row lock serializes assessment creation and transitions.
  const [screenings]=await c.query('SELECT * FROM troubleshooting_hazard_assessments WHERE incident_id=? FOR UPDATE',[incidentId]);
  if(!Array.isArray(screenings)||screenings.length>1)fail('REVIEW_STATE_INVALID');
  const a=screenings[0];
  const current=project({...inc[0],review_state:row?.review_state,revision:row?.revision,...(a?{assessment_id:a.assessment_id,assessment_incident_id:a.incident_id,assessment_installation_id:a.installation_id,assessment_tenant_id:a.tenant_id,assessment_device_id:a.device_id,assessment_actor_id:a.actor_user_id,assessment_request_id:a.request_id,assessment:a.assessment}:{})},s);
  const [events]=await c.query('SELECT * FROM troubleshooting_incident_review_events WHERE incident_id=? AND request_id=? FOR UPDATE',[incidentId,requestId]);
  if(!Array.isArray(events)||events.length>1)fail('REVIEW_STATE_INVALID');
  const receipt=(eventId,revision,duplicate)=>({event_id:eventId,incident_id:incidentId,review_state:nextState,revision,duplicate,diagnostic_authorized:false,repair_authorized:false,verified_resolved:false,production_accepted:false});
  if(events.length){
   const e=events[0];
   if(!uuid(e.event_id)||e.incident_id!==incidentId||e.request_id!==requestId||e.installation_id!==s.installation||e.tenant_id!==s.tenant||e.device_id!==deviceId||number(e.actor_user_id)!==s.actor||e.next_state!==nextState||number(e.revision)!==expectedRevision+1||number(e.revision)>current.revision||!allowedReviewTransitions(e.previous_state,current.intake_status).includes(nextState))fail('REVIEW_CONFLICT');
   return {...receipt(e.event_id,number(e.revision),true),current_revision:current.revision,current_review_state:current.review_state};
  }
  if(current.revision!==expectedRevision||!current.allowed_transitions.includes(nextState))fail('REVIEW_CONFLICT');
  const revision=expectedRevision+1,eventId=randomUUID();
  const [w]=row?await c.query('UPDATE troubleshooting_incident_reviews SET review_state=?,revision=?,reviewer_id=?,updated_at=NOW(3) WHERE incident_id=? AND installation_id=? AND tenant_id=? AND device_id=? AND revision=?',[nextState,revision,s.actor,incidentId,s.installation,s.tenant,deviceId,expectedRevision]):await c.query('INSERT INTO troubleshooting_incident_reviews (incident_id,installation_id,tenant_id,device_id,review_state,revision,reviewer_id) VALUES (?,?,?,?,?,?,?)',[incidentId,s.installation,s.tenant,deviceId,nextState,revision,s.actor]);
  if(w?.affectedRows!==1)fail('REVIEW_WRITE_UNCONFIRMED');
  const [event]=await c.query('INSERT INTO troubleshooting_incident_review_events (event_id,incident_id,installation_id,tenant_id,device_id,actor_user_id,request_id,previous_state,next_state,revision) VALUES (?,?,?,?,?,?,?,?,?,?)',[eventId,incidentId,s.installation,s.tenant,deviceId,s.actor,requestId,current.review_state,nextState,revision]);
  if(event?.affectedRows!==1)fail('REVIEW_WRITE_UNCONFIRMED');
  const [audit]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',[randomUUID(),s.tenant,s.actor,String(s.actor),'TROUBLESHOOTING_HUMAN_REVIEW_CHANGED','Incident:'+incidentId,JSON.stringify({event_id:eventId,revision,previous_state:current.review_state,next_state:nextState,...(current.qualified_referral_pending?{hazard_assessment_id:current.hazard_assessment.assessment_id,scope:'QUALIFIED_REFERRAL_RECORD_ONLY'}:{})}),null]);
  if(audit?.affectedRows!==1)fail('REVIEW_WRITE_UNCONFIRMED');
  return receipt(eventId,revision,false);
 });
}
