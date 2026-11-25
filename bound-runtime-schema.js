// Identity-bound API runtime must never initialize, adopt, repair or
// automatically upgrade a database. Operator-controlled migrations precede
// bound API startup. Legacy unbound runtime is handled by db.js separately.
import {identityPolicy,assertDatabaseIdentity} from './installation-database-identity.js';
import {planMigrationHistory} from './schema-migration-integrity.js';
const fail=()=>{throw Error('BOUND_RUNTIME_DATABASE_UNVERIFIED')};
export async function verifyBoundRuntimeHistory(connection,files,env){
 try{
  const pins=identityPolicy(env);
  if(!Array.isArray(files)||files.length!==24)fail();
  const before=await assertDatabaseIdentity(connection,pins);
  if(before!==pins.expectedInstallationId)fail();
  const [rows]=await connection.query('SELECT version,name,checksum FROM schema_migrations');
  const history=planMigrationHistory(files,rows);
  if(history.pending.length||history.applied.length!==24)fail();
  if(await assertDatabaseIdentity(connection,pins)!==before)fail();
  return Object.freeze({applied:[],skipped:history.applied.map(x=>x.name),status:'BOUND_RUNTIME_HISTORY_VERIFIED'});
 }catch{fail()}
}
// A health check is not authorization to write. Use one checked-out session,
// discard it if the identity is absent or changed, and never disclose pins.
export async function probeBoundRuntimeIdentity(pool,env){
 let c,verified=false;
 try{
  const pins=identityPolicy(env);
  c=await pool.getConnection();
  if(await assertDatabaseIdentity(c,pins)!==pins.expectedInstallationId)fail();
  verified=true;return true;
 }catch{return false}
 finally{if(c){if(verified)c.release();else c.destroy()}}
}
