// Read-only deployment status, deliberately excludes secrets and raw error details.
import {isPlatformSettingsAdmin} from './platform-settings-admin.js';
import {identityPolicy,assertDatabaseIdentity} from './installation-database-identity.js';
export async function inspectServerConfiguration(db,env=process.env){
 const connected=db.isMysqlConnected()===true;
 let persistent=false,identity='DISABLED',schemaVersion=null;
 if(connected){
  try{
   const pool=db.getPool();
   const [rows]=await pool.query('SELECT 1 AS reachable');
   persistent=rows?.length===1&&rows[0].reachable===1;
   if(persistent){
    const [m]=await pool.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
    if(m?.length===1&&typeof m[0].version==='string'&&/^[0-9]{3}$/.test(m[0].version))schemaVersion=m[0].version;
   }
  }catch{persistent=false;schemaVersion=null}
 }
 if(env.AADITECH_BOUND_REPORTS==='enabled'){
  identity='UNVERIFIED';
  if(persistent)try{await assertDatabaseIdentity(db.getPool(),identityPolicy(env));identity='MATCHED'}catch{}
 }
 const host=typeof env.SERVER_HOST==='string'&&env.SERVER_HOST.length<=253&&/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(env.SERVER_HOST)?env.SERVER_HOST:null;
 return {database_reachable:persistent,latest_recorded_migration:schemaVersion,report_identity_state:identity,
  configured_server_host:host,agent_origin_policy:'OPERATOR_CONFIGURED_HTTPS',server_host_editable_in_browser:false,
  restart_and_tls_review_required:true,production_accepted:false};
}
export function registerServerConfigurationRoutes(app,db,env=process.env){
 app.get('/api/v1/platform/runtime-configuration',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!isPlatformSettingsAdmin(req.user,env)||!req.token||req.headers.authorization!=='Bearer '+req.token)return res.status(403).json({error:'PLATFORM_ADMIN_REQUIRED'});
  if(Object.keys(req.query).length)return res.status(400).json({error:'INVALID_QUERY'});
  try{return res.json(await inspectServerConfiguration(db,env))}
  catch{return res.status(503).json({error:'RUNTIME_CONFIGURATION_UNAVAILABLE'})}
 });
}
