// Test-only actual Docker load rehearsal. Never accepts external archive input,
// never runs a container, never loads an approved production release.
// Restricted to a disposable GitHub-hosted Linux x64 Actions runner.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {staged} from './fixtures/signed-offline-oci-fixture.mjs';
import {prepareOfflineDockerArchive} from '../scripts/prepare-offline-docker-archive.mjs';
import {verifyPreparedDockerArchive} from '../scripts/verify-prepared-docker-archive.mjs';
import {inspectLocalDockerRuntime} from '../scripts/local-docker-runtime-preflight.mjs';
if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
   process.platform!=='linux'||process.arch!=='x64')throw Error('DISPOSABLE_GITHUB_RUNNER_REQUIRED');
const docker=(args)=>{const r=spawnSync('/usr/bin/docker',['--host','unix:///run/docker.sock',...args],
 {encoding:'utf8',timeout:120000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME||'/tmp'}});
 if(r.status!==0||r.error)throw Error('CI_DOCKER_REHEARSAL_COMMAND_FAILED');return r.stdout};
await staged(async({input,g})=>{
 const destinationParent=join(dirname(dirname(input.stagedDirectory)),'archive-output');
 await mkdir(destinationParent,{mode:0o700});await chmod(destinationParent,0o700);
 const r=await prepareOfflineDockerArchive({...input,confirmation:'PREPARE_UNTAGGED_OFFLINE_DOCKER_ARCHIVE_ONLY',destinationParent});
 const verified=await verifyPreparedDockerArchive({...input,confirmation:'VERIFY_PREPARED_DOCKER_ARCHIVE_ONLY',
  archivePath:r.archive_path,archiveSha256:r.archive_sha256,archiveBytes:r.archive_bytes});
 const policy={confirmation:'OBSERVE_LOCAL_DOCKER_ONLY',architecture:'amd64',imageIds:verified.expected_image_ids};
 const before=await inspectLocalDockerRuntime(policy);
 assert.equal(before.runtime_state,'LOCAL_LINUX_DAEMON_OBSERVED');
 assert.deepEqual(before.images.map(x=>x.state),['NOT_FOUND','NOT_FOUND','NOT_FOUND']);
 try{
  const loaded=docker(['image','load','--input',r.archive_path]);
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
    expected_image_ids:verified.expected_image_ids,reported_load_ids:reported,observations:after.images}));
  }
  assert.equal(after.all_expected_image_ids_observed,true);
  for(const [i,id] of Object.values(verified.expected_image_ids).entries()){
   const [image]=JSON.parse(docker(['image','inspect',id]));
   assert.equal(image.Id,id);assert.equal(image.Os,'linux');assert.equal(image.Architecture,'amd64');
   assert.deepEqual(image.RepoTags??[],[]);assert.deepEqual(image.RootFS.Layers,g.configs[i].rootfs.diff_ids);
  }
 }finally{
  // Only the three random fixture IDs proved absent before load. Never prune,
  // force-delete, remove tags or touch service/production images.
  const current=await inspectLocalDockerRuntime(policy);
  for(const row of current.images){
   if(row.state==='PINNED_ID_OBSERVED')docker(['image','rm',verified.expected_image_ids[row.role]]);
   else assert.equal(row.state,'NOT_FOUND');
  }
  const final=await inspectLocalDockerRuntime(policy);
  assert.deepEqual(final.images.map(x=>x.state),['NOT_FOUND','NOT_FOUND','NOT_FOUND']);
 }
 console.log('PASS: disposable signed fixture archive load, exact untagged config IDs, ordered diff IDs and scoped cleanup; no container execution or production acceptance.');
});
