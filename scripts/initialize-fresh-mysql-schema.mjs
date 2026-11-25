// Connection-level fresh schema reference, NOT a Docker activation adapter.
// Trusted operator must own the exclusive setup lock, private local database
// connection, and guarantee no other application writers or public access.
// DDL is not transactional: any failure requires manual reconciliation, never
// auto-retry or drop/recreate. No user creation, TLS, or production acceptance.
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectStagedLanBundle} from './inspect-staged-lan-bundle.mjs';
import {inspectLocalInstallationIdentity} from './installation-identity-store-posix.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {planMigrationHistory} from '../schema-migration-integrity.js';
import {bindFreshDatabaseIdentity,assertDatabaseIdentity} from '../installation-database-identity.js';
const fail=()=>{throw Error('FRESH_MYSQL_SCHEMA_UNCONFIRMED')};
const sha=b=>createHash('sha256').update(b).digest('hex');
const exact=(o,ks)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_]{1,64}$/.test(x);
const meta=['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'],same=(a,b)=>meta.every(k=>a[k]===b[k]);
const prefix='database/migrations/';
const factoryTenant='00000000-0000-0000-0000-000000000001';
const seeds=Object.freeze({
 user_workspace_memberships:{columns:['user_id','tenant_id'],rows:[[1,factoryTenant],[2,factoryTenant],[3,factoryTenant]]},
 devices:{columns:['id'],rows:[['1'],['2'],['3']]},
 users:{columns:['id'],rows:[[1],[2],[3]]},
 companies:{columns:['id'],rows:[[1]]},
 alert_rules:{columns:['id'],rows:[['rule-1'],['rule-2'],['rule-3'],['rule-4']]},
 groups:{columns:['id'],rows:[['grp-1'],['grp-2'],['grp-3']]},
 policies:{columns:['id'],rows:[['pol-1'],['pol-2']]},
 remediation_policies:{columns:['id'],rows:[['clean_temp'],['restart_spooler'],['reset_network'],['clear_bits']]},
 tenants:{columns:['id'],rows:[[factoryTenant]]}
});
const protectedTables=['schema_migrations','installation_database_identity','system_settings','users','tenants','companies','devices','user_workspace_memberships','troubleshooting_incidents','troubleshooting_diagnostic_plans','troubleshooting_employee_bindings','troubleshooting_incident_reviews','troubleshooting_incident_review_events','troubleshooting_diagnostic_consent','troubleshooting_diagnostic_consent_events','troubleshooting_hazard_assessments'];
const quoted=x=>{if(!id(x))fail();return '\x60'+x+'\x60'};
async function readPrivate(path,max,entry){
 const s=await lstat(path);if(!s.isFile()||s.nlink!==1||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o600||s.size<1||s.size>max||entry&&s.size!==entry.size)fail();
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(s,await fd.stat()))fail();const b=Buffer.alloc(s.size+1);let n=0;
  while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==s.size||!same(s,await fd.stat())||!same(s,await lstat(path)))fail();
  const bytes=b.subarray(0,n);if(entry&&sha(bytes)!==entry.sha256)fail();
  if(bytes.includes(0)||bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)fail();
  return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),sha256:sha(bytes)};
 }finally{await fd.close()}
}
export function selectSignedMigrationEntries(files){
 if(!Array.isArray(files))fail();
 const selected=files.filter(x=>typeof x?.path==='string'&&x.path.startsWith(prefix)&&x.path.endsWith('.sql')).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(selected.length!==24||selected.some((e,i)=>!new RegExp('^'+prefix+String(i+1).padStart(3,'0')+'_[a-z0-9_]+\\.sql$').test(e.path)||!Number.isSafeInteger(e.size)||e.size<1||e.size>1048576||!hex(e.sha256)))fail();
 return Object.freeze(selected.map(e=>Object.freeze({path:e.path,size:e.size,sha256:e.sha256})));
}
export async function admitSignedFreshMigrations(input){
 if(!exact(input,['confirmation','stagedDirectory','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256'])||input.confirmation!=='ADMIT_SIGNED_FRESH_MYSQL_MIGRATIONS_ONLY')fail();
 const pins={...input,confirmation:'INSPECT_STAGED_RELEASE_ONLY'};
 const before=await inspectStagedLanBundle(pins),manifest=await readPrivate(join(pins.stagedDirectory,'manifest.json'),2*1024*1024);
 if(manifest.sha256!==pins.trustedManifestSha256)fail();
 rejectDuplicateJsonKeys(manifest.text);const entries=selectSignedMigrationEntries(JSON.parse(manifest.text).files),files=[];
 for(const e of entries){const b=await readPrivate(join(pins.stagedDirectory,'payload',e.path),1048576,e);files.push(Object.freeze({name:e.path.slice(prefix.length),sql:b.text}))}
 const history=planMigrationHistory(files,[]);if(history.pending.length!==24||history.pending.some((x,i)=>x.checksum!==entries[i].sha256))fail();
 if(JSON.stringify(before)!==JSON.stringify(await inspectStagedLanBundle(pins)))fail();
 return Object.freeze({manifest_sha256:pins.trustedManifestSha256,files:Object.freeze(files),history:history.pending});
}
export function validateFreshSchemaRequest(input){
 if(!exact(input,['confirmation','databaseName','release','identity'])||input.confirmation!=='INITIALIZE_EMPTY_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY'||!id(input.databaseName)||
 !(/^it_toolkit$/.test(input.databaseName)||process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&/^itk_fresh_[0-9]+$/.test(input.databaseName))||
 !exact(input.release,['confirmation','stagedDirectory','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256'])||!exact(input.identity,['confirmation','directoryPath','expectedInstallationId','expectedIdentitySha256']))fail();
 return Object.freeze({...input,release:Object.freeze({...input.release}),identity:Object.freeze({...input.identity})});
}
export function verifyFactorySeedRows(table,rows){
 const expected=Object.hasOwn(seeds,table)?seeds[table]:null;if(!expected||!Array.isArray(rows)||rows.length!==expected.rows.length)fail();
 const canonical=a=>Array.from(a,x=>JSON.stringify(x.map(String))).sort();
 if(JSON.stringify(canonical(Array.from(rows,r=>{if(!exact(r,expected.columns)||expected.columns.some(k=>!['string','number'].includes(typeof r[k])))fail();return expected.columns.map(k=>r[k])})))!==JSON.stringify(canonical(expected.rows)))fail();
 return expected.rows.length;
}
async function query(c,sql,args=[]){const [rows]=await c.query(sql,args);return rows}
// One shared validation contract for initialization and read-only admission.
// Use a literal prefix and digit check rather than two divergent regexes.
export function validateFreshMySqlSession(rows,databaseName){
 if(!Array.isArray(rows)||rows.length!==1||!rows[0])fail();
 const r=rows[0],version=r.version;
 if(r.db!==databaseName||typeof r.uuid!=='string'||!r.uuid||!['number','string'].includes(typeof r.connection_id)||!Number.isSafeInteger(Number(r.connection_id))||Number(r.connection_id)<1||typeof version!=='string'||!version.startsWith('8.')||!/^[0-9]/.test(version.slice(2))||/MariaDB/i.test(version))fail();
 return Object.freeze({db:r.db,uuid:r.uuid,connection_id:Number(r.connection_id),version});
}
async function tableInventory(c){
 const rows=await query(c,"SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME");
 if(!Array.isArray(rows)||rows.length>200||Array.from(rows).some(x=>!x||!id(x.name)||x.kind!=='BASE TABLE'||x.engine!=='InnoDB')||new Set(rows.map(x=>x.name)).size!==rows.length)fail();
 for(const [table,column] of [['ROUTINES','ROUTINE_SCHEMA'],['TRIGGERS','TRIGGER_SCHEMA'],['EVENTS','EVENT_SCHEMA']]){
  const r=await query(c,'SELECT COUNT(*) AS n FROM information_schema.'+table+' WHERE '+column+'=DATABASE()');if(r?.length!==1||Number(r[0].n)!==0)fail();
 }
 return rows.map(x=>x.name);
}
export async function initializeFreshMySqlSchema(connection,input,assertHeld){
 const p=validateFreshSchemaRequest(input);if(typeof assertHeld!=='function'||!connection||typeof connection.query!=='function'||typeof connection.destroy!=='function')fail();
 let transaction=false,done=false;
 try{
 await assertHeld();const admitted=await admitSignedFreshMigrations(p.release),local=await inspectLocalInstallationIdentity(p.identity);
 const observe=async()=>{await assertHeld();return validateFreshMySqlSession(await query(connection,'SELECT DATABASE() AS db,@@server_uuid AS uuid,CONNECTION_ID() AS connection_id,@@version AS version'),p.databaseName)};
 const initial=await observe(),lockName='itk_schema_migrations_lock';
 const guard=async()=>{if(JSON.stringify(await observe())!==JSON.stringify(initial))fail();const r=await query(connection,'SELECT IS_USED_LOCK(?) AS owner',[lockName]);if(r?.length!==1||Number(r[0].owner)!==Number(initial.connection_id))fail();await assertHeld()};
  const acquired=await query(connection,'SELECT GET_LOCK(?,0) AS acquired',[lockName]);if(acquired?.length!==1||acquired[0].acquired!==1)fail();
  await guard();if((await tableInventory(connection)).length)fail();
  await guard();
  await connection.query('CREATE TABLE schema_migrations (version VARCHAR(64) NOT NULL PRIMARY KEY,name VARCHAR(255) NOT NULL,applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),execution_time_ms INT NOT NULL DEFAULT 0,checksum VARCHAR(64) NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  for(const f of admitted.history){
   await guard();const t=Date.now();await connection.query(f.sql);
   const w=await query(connection,'INSERT INTO schema_migrations(version,name,execution_time_ms,checksum) VALUES(?,?,?,?)',[f.version,f.name,Date.now()-t,f.checksum]);if(w?.affectedRows!==1)fail();
   await guard();
  }
  const names=await tableInventory(connection);
  if(protectedTables.some(t=>!names.includes(t))||Object.keys(seeds).some(t=>!names.includes(t)))fail();
  const rows=await query(connection,'SELECT version,name,checksum FROM schema_migrations');
  if(planMigrationHistory(admitted.files,rows).pending.length!==0)fail();
  await guard();await connection.beginTransaction();transaction=true;
  // This check/delete is permitted only after this invocation proved an
  // empty schema and applied the entire signed migration history itself.
  // Verify every table is empty or has the exact factory primary keys before
  // deleting any row. No cleanup API is exposed for an existing database.
  for(const table of names){
   if(table==='schema_migrations')continue;
   const seed=Object.hasOwn(seeds,table)?seeds[table]:null;
   if(seed)verifyFactorySeedRows(table,await query(connection,'SELECT '+seed.columns.map(quoted).join(',')+' FROM '+quoted(table)+' LIMIT 100 FOR UPDATE'));
   else{const r=await query(connection,'SELECT 1 AS occupied FROM '+quoted(table)+' LIMIT 1 FOR UPDATE');if(!Array.isArray(r)||r.length)fail()}
  }
  for(const table of Object.keys(seeds)){
   const w=await query(connection,'DELETE FROM '+quoted(table));if(w?.affectedRows!==seeds[table].rows.length)fail();
  }
  for(const table of names.filter(t=>t!=='schema_migrations'))if((await query(connection,'SELECT 1 AS occupied FROM '+quoted(table)+' LIMIT 1 FOR UPDATE')).length)fail();
  await guard();await connection.commit();transaction=false;
  const binding=await bindFreshDatabaseIdentity(connection,p.identity,'BIND_EMPTY_DATABASE_TO_PINNED_IDENTITY_ONLY');
  if(!binding.created||binding.installation_id!==local.installation_id||await assertDatabaseIdentity(connection,p.identity)!==local.installation_id)fail();
  await guard();
  const final=await admitSignedFreshMigrations(p.release);if(final.manifest_sha256!==admitted.manifest_sha256||JSON.stringify(final.history)!==JSON.stringify(admitted.history))fail();
  const after=await query(connection,'SELECT version,name,checksum FROM schema_migrations');if(planMigrationHistory(admitted.files,after).pending.length)fail();
  if((await tableInventory(connection)).join('|')!==names.join('|'))fail();
  for(const table of names.filter(t=>!['schema_migrations','installation_database_identity'].includes(t)))if((await query(connection,'SELECT 1 AS occupied FROM '+quoted(table)+' LIMIT 1')).length)fail();
  // Publish the fresh-only bootstrap marker after identity and emptiness checks.
  // A partial DDL/binding failure before this point never enables first run.
  await guard();await connection.beginTransaction();transaction=true;
  if(await assertDatabaseIdentity(connection,p.identity,true)!==local.installation_id)fail();
  if((await query(connection,'SELECT setting_key FROM system_settings LIMIT 1 FOR UPDATE')).length)fail();
  const marker={setup_complete:false,bootstrap_profile:'clean_install_v1',installation_id:local.installation_id,identity_sha256:local.identity_sha256};
  const mark=await query(connection,"INSERT INTO system_settings(setting_key,setting_value) VALUES('branding',?)",[JSON.stringify(marker)]);if(mark?.affectedRows!==1)fail();
  const saved=await query(connection,"SELECT setting_value FROM system_settings WHERE setting_key='branding' FOR UPDATE");
  const value=typeof saved?.[0]?.setting_value==='string'?JSON.parse(saved[0].setting_value):saved?.[0]?.setting_value;
  if(saved?.length!==1||!exact(value,Object.keys(marker))||Object.entries(marker).some(([k,v])=>value[k]!==v))fail();
  await guard();await connection.commit();transaction=false;
  await guard();const released=await query(connection,'SELECT RELEASE_LOCK(?) AS released',[lockName]);if(released?.length!==1||released[0].released!==1)fail();
  await assertHeld();done=true;
  return Object.freeze({schema_version:1,database_name:p.databaseName,release_sha256:admitted.manifest_sha256,migrations_applied:24,factory_seed_rows_removed:Object.values(seeds).reduce((n,s)=>n+s.rows.length,0),installation_id:local.installation_id,identity_sha256:local.identity_sha256,database_binding_verified:true,clean_schema_verified:true,bootstrap_ready:true,services_started:false,installation_authorized:false,production_accepted:false});
 }finally{
  // Connection destruction releases a session lock; external setup lock
  // must remain held/retained on every failed or uncertain mutation.
  if(!done){if(transaction)try{await connection.rollback()}catch{}connection.destroy()}
 }
}

// Read-only pre-API admission under the same exclusive host/daemon/writer
// custody as initialization. No recovery, migration, DDL, account creation,
// or authorization to activate any service. Failure destroys the connection;
// the caller retains its cooperative setup lock. Never infer readiness from
// an empty users table or a receipt from a prior process.
export async function verifyInitializedFreshMySqlSchema(connection,input,assertHeld){
 let tx=false,done=false;
 try{
  if(!exact(input,['confirmation','databaseName','release','identity'])||input.confirmation!=='VERIFY_INITIALIZED_FRESH_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY'||typeof assertHeld!=='function'||!connection||typeof connection.query!=='function'||typeof connection.destroy!=='function')fail();
  const p=validateFreshSchemaRequest({...input,confirmation:'INITIALIZE_EMPTY_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY'});
  await assertHeld();
  const admitted=await admitSignedFreshMigrations(p.release),local=await inspectLocalInstallationIdentity(p.identity);
  const observe=async()=>{
   await assertHeld();
   const r=await query(connection,'SELECT DATABASE() AS db,@@server_uuid AS uuid,CONNECTION_ID() AS connection_id,@@version AS version');
   return validateFreshMySqlSession(r,p.databaseName);
  };
  const initial=await observe(),lockName='itk_schema_migrations_lock';
  const acquired=await query(connection,'SELECT GET_LOCK(?,0) AS acquired',[lockName]);
  if(acquired?.length!==1||acquired[0].acquired!==1)fail();
  const guard=async()=>{
   if(JSON.stringify(await observe())!==JSON.stringify(initial))fail();
   const r=await query(connection,'SELECT IS_USED_LOCK(?) AS owner',[lockName]);
   if(r?.length!==1||Number(r[0].owner)!==Number(initial.connection_id))fail();
   await assertHeld();
  };
  await guard();
  await connection.query('START TRANSACTION READ ONLY');tx=true;
  const names=await tableInventory(connection);
  if(protectedTables.some(t=>!names.includes(t))||Object.keys(seeds).some(t=>!names.includes(t)))fail();
  const rows=await query(connection,'SELECT version,name,checksum FROM schema_migrations');
  const history=planMigrationHistory(admitted.files,rows);
  if(history.pending.length!==0||history.applied.length!==24)fail();
  if(await assertDatabaseIdentity(connection,p.identity)!==local.installation_id)fail();
  const settings=await query(connection,'SELECT setting_key,setting_value FROM system_settings LIMIT 2');
  if(settings?.length!==1||settings[0].setting_key!=='branding')fail();
  const marker=typeof settings[0].setting_value==='string'?JSON.parse(settings[0].setting_value):settings[0].setting_value;
  if(!exact(marker,['setup_complete','bootstrap_profile','installation_id','identity_sha256'])||marker.setup_complete!==false||marker.bootstrap_profile!=='clean_install_v1'||marker.installation_id!==local.installation_id||marker.identity_sha256!==local.identity_sha256)fail();
  for(const table of names.filter(t=>!['schema_migrations','installation_database_identity','system_settings'].includes(t))){
   const occupied=await query(connection,'SELECT 1 AS occupied FROM '+quoted(table)+' LIMIT 1');
   if(!Array.isArray(occupied)||occupied.length)fail();
  }
  await guard();
  const final=await admitSignedFreshMigrations(p.release);
  if(final.manifest_sha256!==admitted.manifest_sha256||JSON.stringify(final.history)!==JSON.stringify(admitted.history)||(await tableInventory(connection)).join('|')!==names.join('|')||await assertDatabaseIdentity(connection,p.identity)!==local.installation_id)fail();
  await guard();await connection.rollback();tx=false;
  await guard();
  const released=await query(connection,'SELECT RELEASE_LOCK(?) AS released',[lockName]);
  if(released?.length!==1||released[0].released!==1)fail();
  await assertHeld();done=true;
  return Object.freeze({schema_version:1,database_name:p.databaseName,release_sha256:admitted.manifest_sha256,migrations_verified:24,installation_id:local.installation_id,identity_sha256:local.identity_sha256,database_binding_verified:true,clean_bootstrap_verified:true,read_only:true,api_activation_authorized:false,production_accepted:false});
 }finally{
  if(!done&&connection&&typeof connection.destroy==='function'){
   if(tx)try{await connection.rollback()}catch{}
   connection.destroy();
  }
 }
}
