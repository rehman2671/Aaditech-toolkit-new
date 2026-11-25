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
  match(rows,local);
  const after=await inspectLocalInstallationIdentity(policy);
  if(after.installation_id!==local.installation_id||after.identity_sha256!==local.identity_sha256)fail();
  return local.installation_id;
 }catch{fail()}
}
// Operator-only and quiescent fresh target; emptiness checks cover enrolled
// devices and troubleshooting records, not the entire application's history.
export async function bindFreshDatabaseIdentity(connection,policy,confirmation){
 if(confirmation!=='BIND_EMPTY_DATABASE_TO_PINNED_IDENTITY_ONLY')fail();
 const local=await inspectLocalInstallationIdentity(policy);
 let committed=false,commitStarted=false,begun=false;
 try{
  await connection.beginTransaction();begun=true;
  const [rows]=await connection.query(select+' FOR UPDATE');
  if(!Array.isArray(rows))fail();
  if(rows.length)match(rows,local);
  else{
   for(const table of ['devices','troubleshooting_incidents','troubleshooting_diagnostic_plans','troubleshooting_employee_bindings','troubleshooting_incident_reviews','troubleshooting_incident_review_events','troubleshooting_diagnostic_consent','troubleshooting_diagnostic_consent_events','troubleshooting_hazard_assessments']){
    const [data]=await connection.query('SELECT 1 AS occupied FROM '+table+' LIMIT 1 FOR UPDATE');
    if(!Array.isArray(data)||data.length)fail();
   }
   const [insert]=await connection.execute('INSERT INTO installation_database_identity (singleton_id,installation_id,identity_sha256) VALUES (1,?,?)',[local.installation_id,local.identity_sha256]);
   if(insert?.affectedRows!==1)fail();
  }
  const [after]=await connection.query(select+' FOR UPDATE');match(after,local);
  const current=await inspectLocalInstallationIdentity(policy);
  if(current.installation_id!==local.installation_id||current.identity_sha256!==local.identity_sha256)fail();
  commitStarted=true;await connection.commit();committed=true;
  return Object.freeze({database_binding_verified:true,installation_id:local.installation_id,created:rows.length===0,production_accepted:false});
 }finally{if(!committed){try{await connection.rollback()}catch{commitStarted=true}if((!begun||commitStarted)&&typeof connection.destroy==='function')connection.destroy()}}
}
// Existing business service owns transaction lifecycle; binding is checked
// under the same row lock, both before business queries and before commit.
export function boundReportPool(pool,policy,expectedId){
 return {async getConnection(){
  const c=await pool.getConnection();let state='NEW',uncertain=false;
  const transition=(from,to)=>{if(state!==from)fail();state=to};
  return {
   async beginTransaction(){transition('NEW','BEGINNING');try{await c.beginTransaction();transition('BEGINNING','VERIFYING');if(await assertDatabaseIdentity(c,policy,true)!==expectedId)fail();transition('VERIFYING','ACTIVE')}catch(e){if(state==='BEGINNING')uncertain=true;if(state!=='CLOSED')state='UNVERIFIED';throw e}},
   query:(...a)=>{if(state!=='ACTIVE')fail();return c.query(...a)},
   async commit(){transition('ACTIVE','VERIFYING');try{if(await assertDatabaseIdentity(c,policy,true)!==expectedId)fail();transition('VERIFYING','COMMITTING');uncertain=true;await c.commit();transition('COMMITTING','DONE');uncertain=false}catch(e){if(state!=='CLOSED')state='UNVERIFIED';throw e}},
   async rollback(){if(!['ACTIVE','UNVERIFIED'].includes(state))fail();state='ROLLING_BACK';try{await c.rollback();transition('ROLLING_BACK',uncertain?'DISCARD':'DONE')}catch(e){uncertain=true;if(state!=='CLOSED')state='UNVERIFIED';throw e}},
   release:()=>{if(state==='DONE'||state==='NEW'){state='CLOSED';return c.release()}if(state!=='CLOSED'){state='CLOSED';return c.destroy()}},destroy:()=>{if(state!=='CLOSED'){state='CLOSED';return c.destroy()}}
  };
 }};
}
