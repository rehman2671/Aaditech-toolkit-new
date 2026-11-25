// Disposable GitHub-hosted runner only. Real MySQL container component
// rehearsal, NOT a publisher-signed image or end-to-end installer activation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,rm,readdir,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {candidateLabels,candidateProcessSpec,freshDatabaseHealthCommand,verifyRunningFreshDatabase,openPinnedFreshDatabaseConnection} from '../scripts/create-stopped-compose-candidates.mjs';
import {expectedFreshResources} from '../scripts/provision-fresh-compose-resources.mjs';
import {initializeFreshMySqlSchema,verifyInitializedFreshMySqlSchema} from '../scripts/initialize-fresh-mysql-schema.mjs';
import {initializeLocalInstallationIdentity} from '../scripts/installation-identity-store-posix.mjs';
import {withLocalSetupLock} from '../scripts/local-setup-lock.mjs';
import {staged} from './fixtures/signed-offline-oci-fixture.mjs';
if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.platform!=='linux'||process.arch!=='x64')throw Error('DISPOSABLE_GITHUB_RUNNER_REQUIRED');
const docker=(args,env={})=>{
 const r=spawnSync('/usr/bin/docker',['--host','unix:///run/docker.sock',...args],{encoding:'utf8',timeout:120000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,...env}});
 if(r.status!==0||r.error)throw Error('DISPOSABLE_DATABASE_COMMAND_FAILED');
 return r.stdout.trim();
};
const inspect=(kind,key)=>{const a=JSON.parse(docker([kind,'inspect',key]));assert.equal(a.length,1);return a[0]};
const asLabels=labels=>Object.entries(labels).flatMap(([k,v])=>['--label',k+'='+v]);
const project='at_db_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(await realpath(tmpdir()),'at-db-bridge-'));
const env={MYSQL_DATABASE:'it_toolkit',MYSQL_USER:'itk_user',MYSQL_PASSWORD:randomBytes(32).toString('hex'),MYSQL_ROOT_PASSWORD:randomBytes(32).toString('hex')};
let networkId,volume,id,conn;
try{
 const files=new Map();
 for(const f of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')))files.set('database/migrations/'+f,await readFile(new URL('../database/migrations/'+f,import.meta.url)));
 // Same MySQL 8.0 family as the existing CI services; pin the observed
 // immutable image ID for this runner, not a production publisher pin.
 docker(['image','pull','mysql:8.0']);
 const image=inspect('image','mysql:8.0');
 assert.match(image.Id,/^sha256:[a-f0-9]{64}$/);
 assert.equal(image.Os,'linux');assert.equal(image.Architecture,'amd64');
 const imageEnvironment=Object.fromEntries((image.Config.Env??[]).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}));
 const identityDirectory=join(root,'identity'),lockRoot=join(root,'lock');
 await mkdir(identityDirectory,{mode:0o700});await mkdir(lockRoot,{mode:0o700});
 const identity=await initializeLocalInstallationIdentity({confirmation:'INITIALIZE_EMPTY_IDENTITY_STORE_ONLY',directoryPath:identityDirectory,observed:{database:'absent',credentials:'absent',service:'absent'}});
 const pins={confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:identityDirectory,expectedInstallationId:identity.installation_id,expectedIdentitySha256:identity.identity_sha256};
 const lock=fn=>withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot},fn);
 await staged(async({input})=>{
  const resources=expectedFreshResources(project,input.trustedManifestSha256),dbVolume=resources.volumes.find(v=>v.name===project+'_mysqldata');
  const labels=candidateLabels(project,input.trustedManifestSha256,'a'.repeat(64),'db');
  networkId=docker(['network','create','--driver','bridge','--internal',...asLabels(resources.network.labels),resources.network.name]);
  volume=docker(['volume','create','--driver','local',...asLabels(dbVolume.labels),dbVolume.name]);
  id=docker(['container','create','--pull','never','--name',project+'-db-1','--network',networkId,'--network-alias','db','--restart','no','--security-opt','no-new-privileges=true','--mount','type=volume,source='+volume+',target=/var/lib/mysql,volume-nocopy',...asLabels(labels),...Object.keys(env).flatMap(k=>['--env',k]),'--health-cmd',freshDatabaseHealthCommand,'--health-interval','5s','--health-timeout','5s','--health-retries','20',image.Id],env);
  const expected={id,imageId:image.Id,project,role:'db',networkId,labels,environment:env,imageEnvironment,imageProcess:candidateProcessSpec(image.Config),identityMount:null};
  assert.equal(inspect('container',id).State.Status,'created');
  const {architecture,...release}=input;
  const request={confirmation:'INITIALIZE_EMPTY_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY',databaseName:'it_toolkit',release:{...release,confirmation:'ADMIT_SIGNED_FRESH_MYSQL_MIGRATIONS_ONLY'},identity:pins};
  const readRequest={...request,confirmation:'VERIFY_INITIALIZED_FRESH_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY'};
  await lock(async({assertHeld})=>{
   await assertHeld();docker(['container','start',id]);
   let pin;
   function observe(){
    const {health,...current}=verifyRunningFreshDatabase(inspect('container',id),expected,inspect('network',networkId));
    if(pin)assert.deepEqual(current,pin);else pin=current;
    return health;
   }
   const deadline=performance.now()+180000;
   while(observe()!=='healthy'){if(performance.now()>deadline)throw Error('MYSQL_READINESS_TIMEOUT');await sleep(2000)}
   const guard=async()=>{await assertHeld();assert.equal(observe(),'healthy');await assertHeld()};
   conn=await openPinnedFreshDatabaseConnection(pin.ip,env);
   const result=await initializeFreshMySqlSchema(conn,request,guard);
   assert.equal(result.migrations_applied,24);assert.equal(result.bootstrap_ready,true);assert.equal(result.database_binding_verified,true);
   const ready=await verifyInitializedFreshMySqlSchema(conn,readRequest,guard);
   assert.equal(ready.migrations_verified,24);assert.equal(ready.clean_bootstrap_verified,true);assert.equal(ready.read_only,true);assert.equal(ready.api_activation_authorized,false);assert.equal(ready.installation_id,identity.installation_id);
   const [[row]]=await conn.query('SELECT installation_id,identity_sha256 FROM installation_database_identity');
   assert.equal(row.installation_id,identity.installation_id);assert.equal(row.identity_sha256,identity.identity_sha256);
   const [[count]]=await conn.query('SELECT COUNT(*) AS n FROM schema_migrations');assert.equal(Number(count.n),24);
   const [[users]]=await conn.query('SELECT COUNT(*) AS n FROM users');assert.equal(Number(users.n),0);
   await guard();await conn.end();conn=undefined;
  });
  assert.deepEqual(await readdir(lockRoot),[]);
  // A second initialization must deny the occupied schema and retain lock.
  const endpoint=verifyRunningFreshDatabase(inspect('container',id),expected,inspect('network',networkId));
  // Exercise read-only denial on deliberate CI-only drift, then restore the
  // fixture using a separate scoped session. Never repair real data here.
  const driftCases=[
   ["UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.setup_complete',true) WHERE setting_key='branding'","UPDATE system_settings SET setting_value=? WHERE setting_key='branding'"],
   ["UPDATE schema_migrations SET checksum=REPEAT('0',64) WHERE version='001'","UPDATE schema_migrations SET checksum=? WHERE version='001'"]
  ];
  for(let i=0;i<driftCases.length;i++){
   const failureRoot=join(root,'drift-lock-'+i);await mkdir(failureRoot,{mode:0o700});
   conn=await openPinnedFreshDatabaseConnection(endpoint.ip,env);
   const [saved]=await conn.query(i===0?"SELECT setting_value AS value FROM system_settings WHERE setting_key='branding'":"SELECT checksum AS value FROM schema_migrations WHERE version='001'");
   assert.equal(saved.length,1);
   const original=i===0&&typeof saved[0].value!=='string'?JSON.stringify(saved[0].value):saved[0].value;
   await conn.query(driftCases[i][0]);await conn.end();conn=undefined;
   conn=await openPinnedFreshDatabaseConnection(endpoint.ip,env);
   await assert.rejects(()=>withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:failureRoot},({assertHeld})=>verifyInitializedFreshMySqlSchema(conn,readRequest,assertHeld)));
   conn=undefined;
   assert.deepEqual(await readdir(failureRoot),['setup.lock']);
   conn=await openPinnedFreshDatabaseConnection(endpoint.ip,env);
   const [drift]=await conn.query(i===0?"SELECT setting_value AS value FROM system_settings WHERE setting_key='branding'":"SELECT checksum AS value FROM schema_migrations WHERE version='001'");
   assert.notDeepEqual(drift[0].value,saved[0].value);
   await conn.query(driftCases[i][1],[original]);await conn.end();conn=undefined;
  }
  conn=await openPinnedFreshDatabaseConnection(endpoint.ip,env);
  await lock(async({assertHeld})=>{const ready=await verifyInitializedFreshMySqlSchema(conn,readRequest,assertHeld);assert.equal(ready.clean_bootstrap_verified,true)});
  await conn.end();conn=undefined;
  conn=await openPinnedFreshDatabaseConnection(endpoint.ip,env);
  await assert.rejects(()=>lock(({assertHeld})=>initializeFreshMySqlSchema(conn,request,assertHeld)));
  conn=undefined;
  assert.deepEqual(await readdir(lockRoot),['setup.lock']);
  conn=await openPinnedFreshDatabaseConnection(endpoint.ip,env);
  const [[count]]=await conn.query('SELECT COUNT(*) AS n FROM schema_migrations');assert.equal(Number(count.n),24);
  await conn.end();conn=undefined;
  console.log('PASS: real disposable MySQL 8 container, private bridge endpoint, scoped account, signed 24 migrations, identity binding, read-only fresh admission, marker/history drift denial, occupied denial and retained lock; not signed runtime activation.');
 },null,files);
}finally{
 if(conn)conn.destroy();
 // Scoped fixture cleanup only; no shared image removal or prune.
 try{if(id)docker(['container','rm','--force',id])}finally{try{if(volume)docker(['volume','rm',volume])}finally{try{if(networkId)docker(['network','rm',networkId])}finally{await rm(root,{recursive:true,force:true})}}}
}
