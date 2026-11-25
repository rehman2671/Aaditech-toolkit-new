// Test-only actual Docker load rehearsal. Never accepts external archive input,
// never runs a container, never loads an approved production release.
// Restricted to a disposable GitHub-hosted Linux x64 Actions runner.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,chmod,readFile,lstat,readdir,writeFile,unlink} from 'node:fs/promises';
import {initializeLocalInstallationIdentity} from '../scripts/installation-identity-store-posix.mjs';
import {createStoppedComposeCandidates,inspectStoppedComposeCandidates} from '../scripts/create-stopped-compose-candidates.mjs';
import {operateExistingComposeServices} from '../scripts/local-compose-service-lifecycle.mjs';
import {initializeFreshComposeEnvironment,validateFreshEnvironmentText} from '../scripts/initialize-fresh-compose-environment.mjs';
import {randomUUID} from 'node:crypto';
import {provisionFreshComposeResources,expectedFreshResources} from '../scripts/provision-fresh-compose-resources.mjs';
import {inspectFreshComposeResources} from '../scripts/fresh-compose-resource-inventory.mjs';
import {join,dirname} from 'node:path';
import {staged} from './fixtures/signed-offline-oci-fixture.mjs';
import {prepareNativeOciArchive} from '../scripts/prepare-native-oci-archive.mjs';
import {importNativeOciArchive} from '../scripts/import-native-oci-archive.mjs';
import {prepareOfflineDockerArchive} from '../scripts/prepare-offline-docker-archive.mjs';
import {verifyPreparedDockerArchive} from '../scripts/verify-prepared-docker-archive.mjs';
import {inspectLocalDockerRuntime} from '../scripts/local-docker-runtime-preflight.mjs';
import {inspectBoundOfflineRuntime} from '../scripts/inspect-offline-oci-runtime.mjs';
if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
   process.platform!=='linux'||process.arch!=='x64')throw Error('DISPOSABLE_GITHUB_RUNNER_REQUIRED');
// Root is required only on this disposable runner to verify real volume directories.
if(process.geteuid()!==0){const r=spawnSync('/usr/bin/sudo',['--non-interactive','--','/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME=/root','GITHUB_ACTIONS=true','RUNNER_ENVIRONMENT=github-hosted',process.execPath,process.argv[1]],{stdio:'inherit',timeout:480000});if(r.status!==0||r.error)throw Error('DISPOSABLE_ROOT_STORAGE_REHEARSAL_FAILED');process.exit(0)}
const docker=(args)=>{const r=spawnSync('/usr/bin/docker',['--host','unix:///run/docker.sock',...args],
 {encoding:'utf8',timeout:120000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME||'/tmp'}});
 if(r.status!==0||r.error)throw Error('CI_DOCKER_REHEARSAL_COMMAND_FAILED');return r.stdout};
const migrationFiles=new Map();
for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')))migrationFiles.set('database/migrations/'+file,await readFile(new URL('../database/migrations/'+file,import.meta.url)));
await staged(async({input,g})=>{
 const destinationParent=join(dirname(dirname(input.stagedDirectory)),'archive-output');
 await mkdir(destinationParent,{mode:0o700});await chmod(destinationParent,0o700);
 const r=await prepareOfflineDockerArchive({...input,confirmation:'PREPARE_UNTAGGED_OFFLINE_DOCKER_ARCHIVE_ONLY',destinationParent});
 const verified=await verifyPreparedDockerArchive({...input,confirmation:'VERIFY_PREPARED_DOCKER_ARCHIVE_ONLY',
  archivePath:r.archive_path,archiveSha256:r.archive_sha256,archiveBytes:r.archive_bytes});
 // Select the known store profile before load, never from returned IDs.
 const driver=docker(['info','--format','{{.Driver}}']).trim();
 const status=JSON.parse(docker(['info','--format','{{json .DriverStatus}}']));
 const containerd=Array.isArray(status)&&status.some(x=>Array.isArray(x)&&x[0]==='driver-type'&&x[1]==='io.containerd.snapshotter.v1');
 assert.ok(containerd||driver==='overlay2','Unsupported fixture image store');
 const native=containerd?await prepareNativeOciArchive({...input,confirmation:'PREPARE_NATIVE_OCI_ARCHIVE_ONLY',destinationParent}):null;
 const selected=native?{expected_image_ids:native.expected_manifest_ids}:verified;
 const lockRoot=join(dirname(destinationParent),'import-lock');await mkdir(lockRoot,{mode:0o700});
 const policy={confirmation:'OBSERVE_LOCAL_DOCKER_ONLY',architecture:'amd64',imageIds:selected.expected_image_ids};
 const before=await inspectLocalDockerRuntime(policy);
 assert.equal(before.runtime_state,'LOCAL_LINUX_DAEMON_OBSERVED');
 assert.deepEqual(before.images.map(x=>x.state),['NOT_FOUND','NOT_FOUND','NOT_FOUND']);
 const boundBefore=await inspectBoundOfflineRuntime(input);assert.equal(boundBefore.store_profile,containerd?'NATIVE_CONTAINERD':'CLASSIC_OVERLAY2');assert.equal(boundBefore.runtime.all_expected_image_ids_observed,false);
 try{
  let loaded='';
  if(native){
   const receipt=await importNativeOciArchive({confirmation:'IMPORT_PINNED_NATIVE_OCI_IMAGES_ONLY_EXCLUSIVE_DAEMON_CUSTODY',lockRoot,admission:{...input,confirmation:'VERIFY_NATIVE_OCI_ARCHIVE_ONLY',archivePath:native.archive_path,archiveSha256:native.archive_sha256,archiveBytes:native.archive_bytes}});
   assert.equal(receipt.images_imported,true);assert.equal(receipt.container_execution_performed,false);
  }else loaded=docker(['image','load','--input',r.archive_path]);
  const after=await inspectLocalDockerRuntime(policy);
  if(!after.all_expected_image_ids_observed){
   // Fixture-only diagnostics. Do not dump daemon info, env/config, or
   // unrelated images. Do not accept returned IDs as replacement pins.
   const reported=[...new Set([...loaded.matchAll(/sha256:[a-f0-9]{64}/g)].map(x=>x[0]))].slice(0,12);
   const version=docker(['version','--format','{{.Server.Version}}']).trim();
   const driver=docker(['info','--format','{{.Driver}}']).trim();
   console.error(JSON.stringify({event:'FIXTURE_LOAD_IDENTITY_MISMATCH',
    daemon_version:/^[a-zA-Z0-9.+_-]{1,80}$/.test(version)?version:'unverified',
    storage_driver:/^[a-zA-Z0-9_-]{1,80}$/.test(driver)?driver:'unverified',
    expected_image_ids:selected.expected_image_ids,reported_load_ids:reported,observations:after.images}));
  }
  assert.equal(after.all_expected_image_ids_observed,true);
  const boundAfter=await inspectBoundOfflineRuntime(input);assert.equal(boundAfter.store_profile,boundBefore.store_profile);assert.equal(boundAfter.runtime.all_expected_image_ids_observed,true);assert.equal(boundAfter.installation_authorized,false);
  for(const [i,id] of Object.values(selected.expected_image_ids).entries()){
   const [image]=JSON.parse(docker(['image','inspect',id]));
   assert.equal(image.Id,id);assert.equal(image.Os,'linux');assert.equal(image.Architecture,'amd64');
   assert.deepEqual(image.RepoTags??[],[]);assert.deepEqual(image.RootFS.Layers,g.configs[i].rootfs.diff_ids);
  }
  const project='at_res_'+randomUUID().replaceAll('-',''),resourceLock=join(dirname(destinationParent),'resource-lock'),repeatLock=join(dirname(destinationParent),'repeat-lock');
  await mkdir(resourceLock,{mode:0o700});await mkdir(repeatLock,{mode:0o700});
  const expected=expectedFreshResources(project,input.trustedManifestSha256);
  const configDirectory=join(dirname(destinationParent),'fresh-config');await mkdir(configDirectory,{mode:0o700});
  const configInput={confirmation:'INITIALIZE_EMPTY_COMPOSE_ENVIRONMENT_ONLY_EXCLUSIVE_DAEMON_CUSTODY',project,lockRoot:resourceLock,configDirectory,serverHost:'fixture.example.com',release:input};
  const config=await initializeFreshComposeEnvironment(configInput),configPath=join(configDirectory,'.env'),configBytes=await readFile(configPath,'utf8');
  assert.equal(config.configuration_created,true);assert.equal(config.secret_count,9);assert.equal(config.installation_authorized,false);
  assert.equal((await lstat(configPath)).mode&0o777,0o600);assert.equal(validateFreshEnvironmentText(configBytes,project,'fixture.example.com').configuration_sha256,config.configuration_sha256);
  await assert.rejects(()=>initializeFreshComposeEnvironment(configInput));assert.equal(await readFile(configPath,'utf8'),configBytes);
  const resourcePolicy={confirmation:'PROVISION_EMPTY_COMPOSE_RESOURCES_ONLY_EXCLUSIVE_DAEMON_CUSTODY',project,lockRoot:resourceLock,release:input};
  const inventory=()=>inspectFreshComposeResources({confirmation:'INSPECT_FRESH_COMPOSE_RESOURCE_COLLISIONS_ONLY',project});
  assert.equal((await inventory()).resource_collision_free_observed,true);
  let receipt,created;
  try{
   receipt=await provisionFreshComposeResources(resourcePolicy);
   assert.equal(receipt.resources_provisioned,true);assert.equal(receipt.containers_created,false);assert.deepEqual((await inventory()).collision_counts,{containers:0,networks:1,volumes:5});
   await assert.rejects(()=>provisionFreshComposeResources({...resourcePolicy,lockRoot:repeatLock}));
   assert.deepEqual((await inventory()).collision_counts,{containers:0,networks:1,volumes:5});
   const identityDirectory=join(dirname(destinationParent),'identity'),runtimeIdentityParent=join(dirname(destinationParent),'runtime-identity-parent');
   await mkdir(identityDirectory,{mode:0o700});await mkdir(runtimeIdentityParent,{mode:0o700});
   const identity=await initializeLocalInstallationIdentity({confirmation:'INITIALIZE_EMPTY_IDENTITY_STORE_ONLY',directoryPath:identityDirectory,observed:{database:'absent',credentials:'absent',service:'absent'}});
   const storage={identity:{confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:identityDirectory,expectedInstallationId:identity.installation_id,expectedIdentitySha256:identity.identity_sha256},runtimeIdentityParent};
   const createInput={...configInput,confirmation:'CREATE_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY',configurationSha256:config.configuration_sha256,networkId:receipt.network_id,storage};
   created=await createStoppedComposeCandidates(createInput);
   assert.equal(created.api_volume_ownership_verified,true);assert.equal(created.identity_mount_verified,true);assert.equal(created.volume_contents_verified,true);
   for(const role of ['api_data','agent_artifacts']){const st=await lstat('/var/lib/docker/volumes/'+project+'_'+role+'/_data');assert.equal(st.uid,1000);assert.equal(st.gid,1000);assert.equal(st.mode&0o777,0o700)}
   assert.equal(created.activation_blocked,true);assert.equal(created.services_started,false);assert.deepEqual((await inventory()).collision_counts,{containers:3,networks:1,volumes:5});
   for(const c of Object.values(created.containers))assert.equal(docker(['container','inspect','--format','{{.State.Status}}',c.containerId]).trim(),'created');
   const observed=await inspectStoppedComposeCandidates({...createInput,confirmation:'INSPECT_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY',containers:created.containers});
   assert.equal(observed.identity_mount_verified,true);assert.equal(observed.api_volume_ownership_verified,true);assert.equal(observed.stopped_candidates_verified,true);assert.equal(observed.signed_migrations_verified,true);assert.equal(observed.containers_created,false);assert.equal(observed.installation_authorized,false);assert.deepEqual(observed.containers,created.containers);
   const identityFile=join(runtimeIdentityParent,'runtime-identity','installation-identity.json');
   assert.deepEqual(await readFile(identityFile),await readFile(join(identityDirectory,'installation-identity.json')));
   const identityStat=await lstat(identityFile);assert.equal(identityStat.uid,1000);assert.equal(identityStat.gid,1000);assert.equal(identityStat.mode&0o777,0o600);
   const occupiedLock=join(dirname(destinationParent),'occupied-storage-lock');await mkdir(occupiedLock,{mode:0o700});
   const fixtureLeaf='/var/lib/docker/volumes/'+project+'_api_data/_data/occupied-fixture';
   await writeFile(fixtureLeaf,'fixture',{flag:'wx',mode:0o600});
   try{
    await assert.rejects(()=>inspectStoppedComposeCandidates({...createInput,lockRoot:occupiedLock,confirmation:'INSPECT_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY',containers:created.containers}));
    assert.deepEqual(await readdir(occupiedLock),['setup.lock']);assert.equal(await readFile(fixtureLeaf,'utf8'),'fixture');
   }finally{await unlink(fixtureLeaf)}
   const blockedLock=join(dirname(destinationParent),'activation-blocked-lock');await mkdir(blockedLock,{mode:0o700});
   await assert.rejects(()=>operateExistingComposeServices({confirmation:'START_PINNED_EXISTING_COMPOSE_CONTAINERS_ONLY',operation:'start',project,lockRoot:blockedLock,containers:created.containers}));
   for(const c of Object.values(created.containers))assert.equal(docker(['container','inspect','--format','{{.State.Status}}',c.containerId]).trim(),'created');
  }finally{
   // Disposable runner only, names generated here and absence proved above.
   // On uncertain provisioning retain resources for runner teardown; never
   // remove resources in production adapter or guess IDs after failure.
   if(created)for(const c of Object.values(created.containers))docker(['container','rm',c.containerId]);
   if(receipt){for(const name of receipt.volume_names)docker(['volume','rm',name]);docker(['network','rm',receipt.network_id]);assert.equal((await inventory()).resource_collision_free_observed,true)}
  }
 }finally{
  // Only the three random fixture IDs proved absent before load. Never prune,
  // force-delete, remove tags or touch service/production images.
  const current=await inspectLocalDockerRuntime(policy);
  for(const row of current.images){
   if(row.state==='PINNED_ID_OBSERVED')docker(['image','rm',selected.expected_image_ids[row.role]]);
   else assert.equal(row.state,'NOT_FOUND');
  }
  const final=await inspectLocalDockerRuntime(policy);
  assert.deepEqual(final.images.map(x=>x.state),['NOT_FOUND','NOT_FOUND','NOT_FOUND']);
 }
 console.log('PASS: disposable signed fixture archive load, exact untagged store-specific pinned IDs, ordered diff IDs and scoped cleanup; no container execution or production acceptance.');
},null,migrationFiles);
