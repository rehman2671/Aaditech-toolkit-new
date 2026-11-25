// Disposable GitHub-hosted runner only. Real MySQL and source-built API
// component rehearsal, NOT publisher-signed image or end-to-end installer activation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,rm,readdir,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {candidateLabels,candidateProcessSpec,freshDatabaseHealthCommand,freshApiHealthCommand,verifyStoppedCandidate,verifyRunningFreshDatabase,verifyRunningFreshPair,verifyRunningFreshTriple,privateCaddyCommand,privateCaddyProcessSpec,verifyFreshApiProbeReceipt,deriveCandidateRoleEnvironment,openPinnedFreshDatabaseConnection} from '../scripts/create-stopped-compose-candidates.mjs';
import {expectedFreshResources} from '../scripts/provision-fresh-compose-resources.mjs';
import {checkOrPrepareFreshRuntimeStorage,runtimeIdentityEnvironment} from '../scripts/fresh-runtime-storage.mjs';
import {initializeFreshMySqlSchema,verifyInitializedFreshMySqlSchema} from '../scripts/initialize-fresh-mysql-schema.mjs';
import {initializeLocalInstallationIdentity} from '../scripts/installation-identity-store-posix.mjs';
import {withLocalSetupLock} from '../scripts/local-setup-lock.mjs';
import {verifyBoundRuntimeHistory} from '../bound-runtime-schema.js';
import {staged} from './fixtures/signed-offline-oci-fixture.mjs';
import {provisionFreshPrivateLanTls,inspectPinnedPrivateLanRuntime} from '../scripts/provision-fresh-private-lan-tls.mjs';
import {probePrivateLanHttps} from '../scripts/probe-private-lan-https.mjs';
import {rehearsePrivateLanForwarder} from './fixtures/rehearse-private-lan-forwarder.mjs';
if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.platform!=='linux'||process.arch!=='x64')throw Error('DISPOSABLE_GITHUB_RUNNER_REQUIRED');
// Same isolated-runner root boundary as the existing offline storage rehearsal.
// Root is needed for exact volume and non-root bind ownership, not for the API.
if(process.geteuid()!==0){
 const r=spawnSync('/usr/bin/sudo',['--non-interactive','--','/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME=/root','GITHUB_ACTIONS=true','RUNNER_ENVIRONMENT=github-hosted',process.execPath,process.argv[1]],{stdio:'inherit',timeout:570000});
 if(r.status!==0||r.error)throw Error('DISPOSABLE_ROOT_API_REHEARSAL_FAILED');process.exit(0);
}
const docker=(args,env={},timeout=120000)=>{
 const r=spawnSync('/usr/bin/docker',['--host','unix:///run/docker.sock',...args],{encoding:'utf8',timeout,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,...env}});
 if(r.status!==0||r.error)throw Error('DISPOSABLE_DATABASE_COMMAND_FAILED');
 return r.stdout.trim();
};
const inspect=(kind,key)=>{const a=JSON.parse(docker([kind,'inspect',key]));assert.equal(a.length,1);return a[0]};
const asLabels=labels=>Object.entries(labels).flatMap(([k,v])=>['--label',k+'='+v]);
const project='at_db_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(await realpath(tmpdir()),'at-db-bridge-'));
const env={MYSQL_DATABASE:'it_toolkit',MYSQL_USER:'itk_user',MYSQL_PASSWORD:randomBytes(32).toString('hex'),MYSQL_ROOT_PASSWORD:randomBytes(32).toString('hex')};
let networkId,volume,id,conn,apiId,apiImageTag,caddyId;
const extraVolumes=[];
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
 const identityDirectory=join(root,'identity'),lockRoot=join(root,'lock'),runtimeIdentityParent=join(root,'runtime');
 await mkdir(identityDirectory,{mode:0o700});await mkdir(lockRoot,{mode:0o700});await mkdir(runtimeIdentityParent,{mode:0o700});
 const identity=await initializeLocalInstallationIdentity({confirmation:'INITIALIZE_EMPTY_IDENTITY_STORE_ONLY',directoryPath:identityDirectory,observed:{database:'absent',credentials:'absent',service:'absent'}});
 const pins={confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:identityDirectory,expectedInstallationId:identity.installation_id,expectedIdentitySha256:identity.identity_sha256};
 const lock=fn=>withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot},fn);
 // Build exactly the checked-out application Dockerfile with its locked npm
 // graph. This is a disposable component image, never publisher approval.
 apiImageTag=project.replaceAll('_','-')+':component';
 docker(['build','--quiet','--tag',apiImageTag,fileURLToPath(new URL('../',import.meta.url))],{},240000);
 const apiImage=inspect('image',apiImageTag);
 assert.match(apiImage.Id,/^sha256:[a-f0-9]{64}$/);assert.equal(apiImage.Config.User,'1000:1000');
 const apiImageEnvironment=Object.fromEntries((apiImage.Config.Env??[]).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}));
 docker(['image','pull','caddy:2-alpine']);
 const caddyImage=inspect('image','caddy:2-alpine');
 assert.match(caddyImage.Id,/^sha256:[a-f0-9]{64}$/);assert.equal(caddyImage.Os,'linux');assert.equal(caddyImage.Architecture,'amd64');
 const caddyImageEnvironment=Object.fromEntries((caddyImage.Config.Env??[]).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}));
 const host='fixture.example.com';
 const caDirectory=join(root,'ca'),tlsDirectory=join(root,'tls');await mkdir(caDirectory,{mode:0o700});await mkdir(tlsDirectory,{mode:0o700});
 const pki=await provisionFreshPrivateLanTls({confirmation:'PROVISION_EMPTY_PRIVATE_LAN_TLS_ONLY_EXCLUSIVE_WRITER_CUSTODY',lockRoot,caDirectory,runtimeDirectory:tlsDirectory,address:'127.0.0.1',hostname:host,identity:pins});
 const rootPem=await readFile(join(caDirectory,'root.crt'),'utf8');
 const tlsInput={confirmation:'INSPECT_PINNED_PRIVATE_LAN_RUNTIME_ONLY',runtimeDirectory:tlsDirectory,address:'127.0.0.1',hostname:host,identity:pins,rootPem,trustedRootSha256:pki.root_sha256,trustedLeafSha256:pki.leaf_sha256,trustedCaddyfileSha256:pki.caddyfile_sha256};
 const secretKeys=['API_TOKEN','JWT_SECRET','BOOTSTRAP_SECRET','HMAC_SECRET','COMMAND_SIGNING_KEY','SETUP_TOKEN','SESSION_SECRET'];
 const config={COMPOSE_PROJECT_NAME:project,MYSQL_DATABASE:env.MYSQL_DATABASE,MYSQL_USER:env.MYSQL_USER,MYSQL_PASSWORD:env.MYSQL_PASSWORD,MYSQL_ROOT_PASSWORD:env.MYSQL_ROOT_PASSWORD,SERVER_HOST:host,CADDY_HOST:host,ENVIRONMENT:'prod',...Object.fromEntries(secretKeys.map(k=>[k,randomBytes(32).toString('hex')]))};
 const configText=Object.entries(config).map(([k,v])=>k+'='+v).join('\n')+'\n';
 const apiEnv={...deriveCandidateRoleEnvironment(configText,project,host).api,...runtimeIdentityEnvironment({identity:pins})};
 await staged(async({input})=>{
  const resources=expectedFreshResources(project,input.trustedManifestSha256),dbVolume=resources.volumes.find(v=>v.name===project+'_mysqldata');
  const labels=candidateLabels(project,input.trustedManifestSha256,'a'.repeat(64),'db');
  networkId=docker(['network','create','--driver','bridge','--internal',...asLabels(resources.network.labels),resources.network.name]);
  volume=docker(['volume','create','--driver','local',...asLabels(dbVolume.labels),dbVolume.name]);
  for(const v of resources.volumes.filter(v=>v.name!==volume))extraVolumes.push(docker(['volume','create','--driver','local',...asLabels(v.labels),v.name]));
  id=docker(['container','create','--pull','never','--name',project+'-db-1','--network',networkId,'--network-alias','db','--restart','no','--security-opt','no-new-privileges=true','--mount','type=volume,source='+volume+',target=/var/lib/mysql,volume-nocopy',...asLabels(labels),...Object.keys(env).flatMap(k=>['--env',k]),'--health-cmd',freshDatabaseHealthCommand,'--health-interval','5s','--health-timeout','5s','--health-retries','20',image.Id],env);
  const expected={id,imageId:image.Id,project,role:'db',networkId,labels,environment:env,imageEnvironment,imageProcess:candidateProcessSpec(image.Config),identityMount:null};
  assert.equal(inspect('container',id).State.Status,'created');
  const {architecture,...release}=input;
  const request={confirmation:'INITIALIZE_EMPTY_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY',databaseName:'it_toolkit',release:{...release,confirmation:'ADMIT_SIGNED_FRESH_MYSQL_MIGRATIONS_ONLY'},identity:pins};
  const readRequest={...request,confirmation:'VERIFY_INITIALIZED_FRESH_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY'};
  let storage;
  const storagePolicy={identity:pins,runtimeIdentityParent};
  const storageCheck=(assertHeld,prepare,databaseVolumeIdentity,apiVolumeIdentities,caddyVolumeIdentities)=>checkOrPrepareFreshRuntimeStorage({storage:storagePolicy,volumes:resources.volumes,inspect,continuity:async()=>{await assertHeld();return {value:JSON.parse(docker(['info','--format','{{json .}}']))}},prepare,databaseVolumeIdentity,apiVolumeIdentities,caddyVolumeIdentities});
  await lock(async({assertHeld})=>{
   storage=await storageCheck(assertHeld,true);
   assert.equal(storage.identity_copy_verified,true);assert.equal(storage.api_volume_ownership_verified,true);
   await assertHeld();docker(['container','start',id]);
   let pin;
   function observe(){
    const {health,...current}=verifyRunningFreshDatabase(inspect('container',id),expected,inspect('network',networkId));
    if(pin)assert.deepEqual(current,pin);else pin=current;
    return health;
   }
   const deadline=performance.now()+180000;
   while(observe()!=='healthy'){if(performance.now()>deadline)throw Error('MYSQL_READINESS_TIMEOUT');await sleep(2000)}
   const guard=async()=>{await assertHeld();assert.equal(observe(),'healthy');await storageCheck(assertHeld,false,storage.databaseVolumeIdentity);await assertHeld()};
   conn=await openPinnedFreshDatabaseConnection(pin.ip,env);
   const result=await initializeFreshMySqlSchema(conn,request,guard);
   assert.equal(result.migrations_applied,24);assert.equal(result.bootstrap_ready,true);assert.equal(result.database_binding_verified,true);
   const ready=await verifyInitializedFreshMySqlSchema(conn,readRequest,guard);
   assert.equal(ready.migrations_verified,24);assert.equal(ready.clean_bootstrap_verified,true);assert.equal(ready.read_only,true);assert.equal(ready.api_activation_authorized,false);assert.equal(ready.installation_id,identity.installation_id);
   const runtimeFiles=Array.from(files,([name,bytes])=>({name:name.slice('database/migrations/'.length),sql:bytes.toString('utf8')}));
   const runtimeEnv={AADITECH_BOUND_REPORTS:'enabled',AADITECH_IDENTITY_DIRECTORY:identityDirectory,AADITECH_INSTALLATION_ID:identity.installation_id,AADITECH_IDENTITY_SHA256:identity.identity_sha256};
   const runtime=await verifyBoundRuntimeHistory(conn,runtimeFiles,runtimeEnv);
   assert.equal(runtime.status,'BOUND_RUNTIME_HISTORY_VERIFIED');assert.equal(runtime.applied.length,0);assert.equal(runtime.skipped.length,24);
   await assert.rejects(()=>verifyBoundRuntimeHistory(conn,runtimeFiles,{...runtimeEnv,AADITECH_IDENTITY_SHA256:'0'.repeat(64)}));
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

  // Actual non-root API component: use the same image, labels, no-copy
  // mounts, pinned identity and exact network verifier as the new adapter.
  const apiLabels=candidateLabels(project,input.trustedManifestSha256,'a'.repeat(64),'api');
  apiLabels['org.aaditech.identity-sha256']=identity.identity_sha256;
  const identityMount={source:storage.source,target:storage.target};
  function createApi(environment){
   return docker(['container','create','--pull','never','--name',project+'-api-1','--network',networkId,'--network-alias','api','--restart','no','--security-opt','no-new-privileges=true',
    '--mount','type=volume,source='+project+'_api_data,target=/data,volume-nocopy',
    '--mount','type=volume,source='+project+'_agent_artifacts,target=/artifacts,volume-nocopy',
    '--mount','type=bind,source='+identityMount.source+',target='+identityMount.target+',readonly,bind-propagation=rprivate',
    ...asLabels(apiLabels),...Object.keys(environment).flatMap(k=>['--env',k]),
    '--health-cmd',freshApiHealthCommand,'--health-interval','5s','--health-timeout','5s','--health-retries','12',apiImage.Id],environment);
  }
  await lock(async({assertHeld})=>{
   await storageCheck(assertHeld,false,storage.databaseVolumeIdentity);
   // A wrong identity must not start a healthy HTTP service or replay migrations.
   const badEnv={...apiEnv,AADITECH_IDENTITY_SHA256:'0'.repeat(64),DB_RETRY_DELAYS:'50,50'};
   apiId=createApi(badEnv);
   docker(['container','start',apiId]);
   const badDeadline=performance.now()+30000;
   while(true){
    const state=inspect('container',apiId).State;
    assert.notEqual(state.Health?.Status,'healthy');
    if(state.Status==='exited'){assert.notEqual(state.ExitCode,0);break}
    if(performance.now()>badDeadline)throw Error('WRONG_IDENTITY_API_DID_NOT_EXIT');
    await sleep(500);
   }
   docker(['container','rm',apiId]);apiId=undefined;
   assert.equal(verifyRunningFreshDatabase(inspect('container',id),expected,inspect('network',networkId)).ip,endpoint.ip);
   await storageCheck(assertHeld,false,storage.databaseVolumeIdentity,storage.apiVolumeIdentities);
   conn=await openPinnedFreshDatabaseConnection(endpoint.ip,env);
   assert.equal((await verifyInitializedFreshMySqlSchema(conn,readRequest,assertHeld)).clean_bootstrap_verified,true);
   await conn.end();conn=undefined;

   apiId=createApi(apiEnv);
   const apiExpected={id:apiId,imageId:apiImage.Id,project,role:'api',networkId,labels:apiLabels,environment:apiEnv,imageEnvironment:apiImageEnvironment,imageProcess:candidateProcessSpec(apiImage.Config),identityMount};
   verifyStoppedCandidate(inspect('container',apiId),apiExpected);
   await assertHeld();docker(['container','start',apiId]);
   let pairPin;
   async function observePair(){
    await assertHeld();
    const pair=verifyRunningFreshPair(inspect('container',id),inspect('container',apiId),{db:expected,api:apiExpected},inspect('network',networkId));
    const {health:dbHealth,...dbPin}=pair.db,{health:apiHealth,...apiPin}=pair.api;
    assert.equal(dbHealth,'healthy');assert.equal(dbPin.ip,endpoint.ip);assert.equal(dbPin.pid,endpoint.pid);assert.equal(dbPin.endpointId,endpoint.endpointId);
    const current={db:dbPin,api:apiPin};if(pairPin)assert.deepEqual(current,pairPin);else pairPin=current;
    await storageCheck(assertHeld,false,storage.databaseVolumeIdentity,storage.apiVolumeIdentities);
    return apiHealth;
   }
   const deadline=performance.now()+90000;
   while(await observePair()!=='healthy'){if(performance.now()>deadline)throw Error('FRESH_API_READINESS_TIMEOUT');await sleep(2000)}
   const proof=JSON.parse(docker(['container','exec','--user','1000:1000',apiId,'node','/app/scripts/probe-fresh-api-runtime.mjs',endpoint.ip],{},30000));
   assert.equal(verifyFreshApiProbeReceipt(proof),true);
   assert.equal(await observePair(),'healthy');
   // The mounted identity must stay read-only for the actual API user.
   docker(['container','exec','--user','1000:1000',apiId,'node','-e',"try{require('node:fs').openSync('/run/aaditech-identity/installation-identity.json','r+');process.exit(1)}catch(e){process.exit(e.code==='EROFS'||e.code==='EACCES'?0:1)}"]);
   assert.equal(await observePair(),'healthy');
   // Real private Caddy component, pinned image ID and exact TLS directory,
   // never mount the CA directory or publish host ports.
   const tls=await inspectPinnedPrivateLanRuntime(tlsInput,assertHeld),tlsMount={source:tls.source,target:tls.target};
   const caddyLabels=candidateLabels(project,input.trustedManifestSha256,'a'.repeat(64),'caddy'),caddyEnv={CADDY_HOST:host};
   caddyLabels['org.aaditech.tls-leaf-sha256']=pki.leaf_sha256;
   caddyLabels['org.aaditech.caddyfile-sha256']=pki.caddyfile_sha256;
   caddyId=docker(['container','create','--pull','never','--name',project+'-caddy-1','--network',networkId,'--network-alias','caddy','--restart','no','--security-opt','no-new-privileges=true',
    '--mount','type=volume,source='+project+'_caddy_data,target=/data,volume-nocopy',
    '--mount','type=volume,source='+project+'_caddy_config,target=/config,volume-nocopy',
    '--mount','type=bind,source='+tlsMount.source+',target='+tlsMount.target+',readonly,bind-propagation=rprivate',
    ...asLabels(caddyLabels),...Object.keys(caddyEnv).flatMap(k=>['--env',k]),'--no-healthcheck',caddyImage.Id,...privateCaddyCommand],caddyEnv);
   const caddyExpected={id:caddyId,imageId:caddyImage.Id,project,role:'caddy',networkId,labels:caddyLabels,environment:caddyEnv,imageEnvironment:caddyImageEnvironment,imageProcess:privateCaddyProcessSpec(caddyImage.Config),identityMount:null,tlsMount};
   verifyStoppedCandidate(inspect('container',caddyId),caddyExpected);
   assert.equal(await observePair(),'healthy');await assertHeld();
   docker(['container','start',caddyId]);
   let triplePin;
   async function observeTriple(){
    await assertHeld();
    const triple=verifyRunningFreshTriple(inspect('container',id),inspect('container',apiId),inspect('container',caddyId),{db:expected,api:apiExpected,caddy:caddyExpected},inspect('network',networkId));
    const {health:dbHealth,...dbPin}=triple.db,{health:apiHealth,...apiPin}=triple.api;
    assert.deepEqual({db:dbPin,api:apiPin},pairPin);
    if(triplePin)assert.deepEqual(triple,triplePin);else triplePin=triple;
    const observedStorage=await storageCheck(assertHeld,false,storage.databaseVolumeIdentity,storage.apiVolumeIdentities,storage.caddyVolumeIdentities);
    assert.deepEqual(observedStorage.caddyVolumeIdentities,storage.caddyVolumeIdentities);
    assert.deepEqual(await inspectPinnedPrivateLanRuntime(tlsInput,assertHeld),tls);
    await assertHeld();return triple.caddy.ip;
   }
   const ingressIp=await observeTriple();
   const httpsInput={confirmation:'PROBE_PINNED_PRIVATE_LAN_HTTPS_ONLY',address:ingressIp,hostname:host,port:443,rootPem,trustedRootSha256:pki.root_sha256,trustedLeafSha256:pki.leaf_sha256};
   // Retry readiness only on this disposable fixture; production adapter
   // must retain the setup lock on failed activation, not retry writes.
   let httpsProof;const httpsDeadline=performance.now()+30000;
   while(!httpsProof){try{httpsProof=await probePrivateLanHttps(httpsInput,async()=>{await observeTriple()})}catch{if(performance.now()>httpsDeadline)throw Error('CADDY_HTTPS_READINESS_TIMEOUT');await sleep(500)}}
   assert.equal(httpsProof.exact_leaf_verified,true);assert.equal(httpsProof.application_readiness_verified,true);assert.equal(httpsProof.private_routes_denied,true);
   await assert.rejects(()=>probePrivateLanHttps({...httpsInput,trustedLeafSha256:'b'.repeat(64)},assertHeld));
   await assert.rejects(()=>probePrivateLanHttps({...httpsInput,hostname:'wrong.example.com'},assertHeld));
   await assert.rejects(()=>probePrivateLanHttps({...httpsInput,trustedRootSha256:'b'.repeat(64)},assertHeld));
   await observeTriple();
   console.log('PASS: real Caddy private HTTPS, pinned direct leaf and root, clean API readiness, private route denial and wrong hostname/root/leaf refusal; no published host port or signed runtime activation.');
   await rehearsePrivateLanForwarder({target:httpsInput,identity:pins,stopBackend:async()=>{docker(['container','stop','--time','3',caddyId]);await assertHeld()}});
   docker(['container','rm','--force',caddyId]);caddyId=undefined;
   // Scoped cleanup before the independent occupied-schema denial check.
   docker(['container','rm','--force',apiId]);apiId=undefined;
   await assertHeld();
  });
  console.log('PASS: actual source-built non-root API container, wrong identity startup refusal, exact DB/API private pair, read-only identity, in-container history/HTTP/clean setup probe; not signed end-to-end activation.');
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
 try{if(caddyId)docker(['container','rm','--force',caddyId])}finally{try{if(apiId)docker(['container','rm','--force',apiId])}finally{try{if(id)docker(['container','rm','--force',id])}finally{try{for(const v of [volume,...extraVolumes].filter(Boolean))docker(['volume','rm',v])}finally{try{if(networkId)docker(['network','rm',networkId])}finally{try{if(apiImageTag)docker(['image','rm',apiImageTag])}finally{await rm(root,{recursive:true,force:true})}}}}}
 }
}
