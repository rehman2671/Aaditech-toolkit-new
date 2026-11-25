import {classifyDeviceObservation} from './device-observations.js';
import {identityPolicy,assertDatabaseIdentity,boundReportPool} from './installation-database-identity.js';
import {createObservationIncident} from './troubleshooting-incidents.js';
export {classifyDeviceObservation};
const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const deviceId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x);
const fail=()=>{throw Error('MONITORING_UNVERIFIED')};
export async function listDeviceObservations(db,principal,after=''){
 if(!['SUPER_ADMIN','OPERATOR'].includes(principal?.role)||!uuid(principal.tenant_id)||(after!==''&&!deviceId(after)))fail();
 if(!db.isMysqlConnected())fail();
 const tenant=principal.tenant_id,pool=db.getPool();
 const [rows]=await pool.query('SELECT id,tenant_id,hostname,status,agent_token_revoked,cpu_usage,memory_usage,disk_free_gb,disk_total_gb,TIMESTAMPDIFF(SECOND,telemetry_reported_at,NOW(3)) AS telemetry_age_seconds FROM devices WHERE tenant_id=?'+(after?' AND id>?':'')+' ORDER BY id LIMIT 51',[tenant,...(after?[after]:[])]);
 if(!Array.isArray(rows)||rows.length>51||new Set(rows.map(r=>r.id)).size!==rows.length)fail();
 const items=rows.slice(0,50).map(r=>classifyDeviceObservation(r,tenant));
 return {items,next_cursor:rows.length===51?items.at(-1).device_id:null,freshness_seconds:freshness,scope:'CURRENT_WORKSPACE',health_verified:false,production_accepted:false};
}
export function registerDeviceObservationRoutes(app,db,env=process.env){
 app.get('/api/v1/monitoring/device-observations',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!['SUPER_ADMIN','OPERATOR'].includes(req.user?.role)||!uuid(req.user.tenant_id)||!req.token||req.headers.authorization!=='Bearer '+req.token)return res.status(403).json({error:'MONITORING_SCOPE_DENIED'});
  if(Object.keys(req.query).some(k=>k!=='after')||(req.query.after!==undefined&&!deviceId(req.query.after)))return res.status(400).json({error:'MONITORING_QUERY_INVALID'});
  try{return res.json(await listDeviceObservations(db,req.user,req.query.after??''))}
  catch{return res.status(503).json({error:'MONITORING_UNAVAILABLE'})}
 });
 app.post('/api/v1/monitoring/observation-incident',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.user?.role!=='SUPER_ADMIN'||!req.token||req.headers.authorization!=='Bearer '+req.token)return res.status(403).json({error:'MONITORING_SCOPE_DENIED'});
  const keys=['deviceId','requestId','signal','confirmation'];
  if(!req.is('application/json')||Object.keys(req.query).length||!req.body||Object.getPrototypeOf(req.body)!==Object.prototype||Object.keys(req.body).length!==keys.length||!keys.every(k=>Object.hasOwn(req.body,k)))return res.status(400).json({error:'MONITORING_QUERY_INVALID'});
  if(!db.isMysqlConnected())return res.status(503).json({error:'MONITORING_UNAVAILABLE'});
  try{const policy=identityPolicy(env),pool=db.getPool(),installationId=await assertDatabaseIdentity(pool,policy);return res.json(await createObservationIncident(boundReportPool(pool,policy,installationId),{...req.body,principal:req.user,installationId}));}
  catch(e){const code=e?.message,status=code==='INCIDENT_INVALID'?400:code==='INCIDENT_SCOPE_DENIED'?403:['OBSERVATION_NOT_CURRENT','OBSERVATION_REPLAY_UNVERIFIED','INCIDENT_IDEMPOTENCY_CONFLICT'].includes(code)?409:503;return res.status(status).json({error:status===503?'OBSERVATION_INCIDENT_UNCONFIRMED':code})}
 });
}
