// Narrow POSIX/MySQL reference. Local pins must be independently provisioned.
// No automatic adoption, rotation, restore, or protection against a hostile DB admin.
import {inspectLocalInstallationIdentity} from './scripts/installation-identity-store-posix.mjs';
const fail=()=>{throw Error('INSTALLATION_DATABASE_IDENTITY_UNVERIFIED')};
export function identityPolicy(env){
 if(env.AADITECH_BOUND_REPORTS!=='enabled')fail();
 return Object.freeze({confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',
  directoryPath:env.AADITECH_IDENTITY_DIRECTORY,expectedInstallationId:env.AADITECH_INSTALLATION_ID,
  expectedIdentitySha256:env.AADITECH_IDENTITY_SHA256});
}
const select='SELECT singleton_id,installation_id,identity_sha256 FROM installation_database_identity';
function match(rows,local){
 if(!Array.isArray(rows)||rows.length!==1||rows[0]?.singleton_id!==1||
    rows[0].installation_id!==local.installation_id||rows[0].identity_sha256!==local.identity_sha256)fail();
}
export async function assertDatabaseIdentity(connection,policy,lock=false){
 try{
  const local=await inspectLocalInstallationIdentity(policy);
  const [rows]=await connection.query(select+(lock?' FOR SHARE':''));
  match(rows,local);return local.installation_id;
 }catch{fail()}
}
// Operator-only and quiescent fresh target; emptiness checks cover enrolled
// devices and troubleshooting records, not the entire application's history.
export async function bindFreshDatabaseIdentity(connection,policy,confirmation){
 if(confirmation!=='BIND_EMPTY_DATABASE_TO_PINNED_IDENTITY_ONLY')fail();
 const local=await inspectLocalInstallationIdentity(policy);
 let committed=false;
 await connection.beginTransaction();
 try{
  const [rows]=await connection.query(select+' FOR UPDATE');
  if(!Array.isArray(rows))fail();
  if(rows.length)match(rows,local);
  else{
   for(const table of ['devices','troubleshooting_incidents','troubleshooting_diagnostic_plans','troubleshooting_employee_bindings','troubleshooting_incident_reviews','troubleshooting_incident_review_events']){
    const [data]=await connection.query('SELECT 1 AS occupied FROM '+table+' LIMIT 1 FOR UPDATE');
    if(!Array.isArray(data)||data.length)fail();
   }
   const [insert]=await connection.execute('INSERT INTO installation_database_identity (singleton_id,installation_id,identity_sha256) VALUES (1,?,?)',[local.installation_id,local.identity_sha256]);
   if(insert?.affectedRows!==1)fail();
  }
  const [after]=await connection.query(select+' FOR UPDATE');match(after,local);
  const current=await inspectLocalInstallationIdentity(policy);
  if(current.installation_id!==local.installation_id||current.identity_sha256!==local.identity_sha256)fail();
  await connection.commit();committed=true;
  return Object.freeze({database_binding_verified:true,installation_id:local.installation_id,created:rows.length===0,production_accepted:false});
 }finally{if(!committed)await connection.rollback().catch(()=>{})}
}
// Existing business service owns transaction lifecycle; binding is checked
// under the same row lock, both before business queries and before commit.
export function boundReportPool(pool,policy,expectedId){
 return {async getConnection(){
  const c=await pool.getConnection();
  return {
   async beginTransaction(){await c.beginTransaction();if(await assertDatabaseIdentity(c,policy,true)!==expectedId)fail()},
   query:(...a)=>c.query(...a),
   async commit(){if(await assertDatabaseIdentity(c,policy,true)!==expectedId)fail();await c.commit()},
   rollback:()=>c.rollback(),release:()=>c.release(),destroy:()=>c.destroy()
  };
 }};
}
