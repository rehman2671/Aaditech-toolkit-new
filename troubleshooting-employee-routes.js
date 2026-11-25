// Existing authenticated user gateway plus persisted tenant/role/device checks.
// No browser installation or tenant override. Explicit opt-in; no fallback.
import {identityPolicy,assertDatabaseIdentity,boundReportPool} from './installation-database-identity.js';
import {changeEmployeeReportBinding,createEmployeeTroubleshootingReport} from './troubleshooting-incidents.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const userId=x=>Number.isSafeInteger(x)&&x>0&&x<=2147483647;
const int=x=>typeof x==='number'?x:typeof x==='string'&&/^[1-9][0-9]*$/.test(x)?Number(x):NaN;
async function listBoundDevices(pool,{principal,installationId}){
 const c=await pool.getConnection();let done=false,discard=false;
 try{
  await c.beginTransaction();
  const [users]=await c.query('SELECT id,tenant_id,role,active,status FROM users WHERE id=? AND tenant_id=? FOR SHARE',[principal.id,principal.tenant_id]);
  const u=users?.length===1?users[0]:null;
  if(!u||int(u.id)!==principal.id||u.tenant_id!==principal.tenant_id||u.role!=='MONITORING'||![1,true,'1'].includes(u.active)||u.status!=='ACTIVE')throw Error('EMPLOYEE_SCOPE_DENIED');
  const [rows]=await c.query("SELECT b.device_id FROM troubleshooting_employee_bindings b JOIN devices d ON d.id=b.device_id AND d.tenant_id=b.tenant_id WHERE b.installation_id=? AND b.tenant_id=? AND b.employee_user_id=? AND b.state='ACTIVE' ORDER BY b.device_id LIMIT 501",[installationId,principal.tenant_id,principal.id]);
  if(!Array.isArray(rows)||rows.length>500||rows.some(r=>!uuid(r.device_id))||new Set(rows.map(r=>r.device_id)).size!==rows.length)throw Error('EMPLOYEE_LIST_UNVERIFIED');
  try{await c.commit();done=true}catch(e){discard=true;throw e}
  return {devices:rows.map(r=>({device_id:r.device_id})),scope:'REPORT_ONLY',diagnostic_authorized:false,repair_authorized:false};
 }finally{if(!done){try{await c.rollback()}catch{discard=true}}if(discard)c.destroy();else c.release()}
}
export function registerBoundEmployeeRoutes(app,db,env=process.env){
 const mount=(method,path,role,keys,service)=>app[method](path,async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!req.user||req.user.role!==role||!userId(req.user.id)||!uuid(req.user.tenant_id))return res.status(403).json({error:'REPORT_SCOPE_DENIED'});
  if(typeof req.headers.authorization!=='string'||!req.token||req.headers.authorization!=='Bearer '+req.token)
   return res.status(403).json({error:'BEARER_REQUIRED'});
  if(Object.keys(req.query).length||(method==='post'&&(!req.is('application/json')||!exact(req.body,keys))))
   return res.status(400).json({error:'REPORT_INPUT_INVALID'});
  if(!db.isMysqlConnected())return res.status(503).json({error:'BOUND_REPORTS_UNAVAILABLE'});
  let policy,pool,id;
  try{policy=identityPolicy(env);pool=db.getPool();id=await assertDatabaseIdentity(pool,policy)}
  catch{return res.status(503).json({error:'BOUND_REPORTS_UNAVAILABLE'})}
  try{
   const data=await service(boundReportPool(pool,policy,id),{...(method==='post'?req.body:{}),principal:req.user,installationId:id});
   return res.json(data);
  }catch(e){
   const code=e?.message;
   if(code==='INSTALLATION_DATABASE_IDENTITY_UNVERIFIED')return res.status(503).json({error:'BOUND_REPORTS_UNAVAILABLE'});
   if(typeof code==='string'&&(code.includes('SCOPE_DENIED')||code.includes('ACTOR_DENIED')))return res.status(403).json({error:'REPORT_SCOPE_DENIED'});
   if(typeof code==='string'&&(code.includes('IDEMPOTENCY_CONFLICT')||code.includes('REPLAY_UNVERIFIED')||code.includes('REGRANT')||code==='EMPLOYEE_BINDING_NOT_FOUND'))return res.status(409).json({error:'REPORT_CONFLICT'});
   if(typeof code==='string'&&code.endsWith('_INVALID'))return res.status(400).json({error:'REPORT_INPUT_INVALID'});
   return res.status(503).json({error:'REPORT_NOT_CONFIRMED'});
  }
 });
 mount('post','/api/v1/troubleshooting/employee-binding','SUPER_ADMIN',['deviceId','employeeId','action','confirmation'],changeEmployeeReportBinding);
 mount('post','/api/v1/troubleshooting/employee-report','MONITORING',['deviceId','requestId','categoryId','hazard','consent'],createEmployeeTroubleshootingReport);
 mount('get','/api/v1/troubleshooting/employee-devices','MONITORING',[],listBoundDevices);
}
