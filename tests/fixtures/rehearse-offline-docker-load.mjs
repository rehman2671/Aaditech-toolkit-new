// CI-only disposable Docker compatibility rehearsal. Never invoked by setup.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,chmod} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {staged} from './signed-offline-oci-fixture.mjs';
import {expectedSyntheticImages,verifySyntheticLoadedImage} from './docker-load-evidence.mjs';
import {inspectOfflineOciRuntime} from '../../scripts/inspect-offline-oci-runtime.mjs';
import {prepareOfflineDockerArchive} from '../../scripts/prepare-offline-docker-archive.mjs';
import {verifyPreparedDockerArchive} from '../../scripts/verify-prepared-docker-archive.mjs';
import {inspectLocalDockerRuntime,requestLocalDockerJson} from '../../scripts/local-docker-runtime-preflight.mjs';
const exec=promisify(execFile),socket='/run/docker.sock';
const gate=process.env;
if(process.platform!=='linux'||gate.GITHUB_ACTIONS!=='true'||gate.RUNNER_ENVIRONMENT!=='github-hosted'||
 gate.RUNNER_OS!=='Linux'||gate.AADITECH_OFFLINE_DOCKER_REHEARSAL!=='isolated-hosted-ci')
 throw Error('DISPOSABLE_HOSTED_CI_REQUIRED');
function layer(name,byte){
 const h=Buffer.alloc(512);h.write(name,0,'ascii');h.write('0000644\0',100,'ascii');
 h.write('0000000\0',108,'ascii');h.write('0000000\0',116,'ascii');h.write('00000000001\0',124,'ascii');
 h.write('00000000000\0',136,'ascii');h.fill(32,148,156);h[156]=48;h.write('ustar\0',257,'ascii');h.write('00',263,'ascii');
 h.write(h.reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148,'ascii');
 const data=Buffer.alloc(512);data[0]=byte;return Buffer.concat([h,data,Buffer.alloc(1024)]);
}
await staged(async({input})=>{
 const root=dirname(dirname(input.stagedDirectory)),destinationParent=join(root,'archive-output'),configDir=join(root,'docker-cli-config');
 for(const dir of [destinationParent,configDir]){await mkdir(dir,{mode:0o700});await chmod(dir,0o700)}
 const docker=async(...args)=>{
  const result=await exec('docker',['--host','unix:///run/docker.sock','--config',configDir,...args],
   {env:{PATH:'/usr/bin:/bin:/usr/local/bin',HOME:configDir,LANG:'C'},timeout:60000,maxBuffer:1024*1024});
  return result.stdout;
 };
 const ids=async()=>[...new Set((await docker('image','ls','--all','--quiet','--no-trunc')).trim().split(/\s+/).filter(Boolean))].sort();
 const release=await inspectOfflineOciRuntime(input),expected=expectedSyntheticImages(release);
 const imageIds=Object.fromEntries(Object.entries(expected).map(([k,v])=>[k,v.id]));
 const observe=()=>inspectLocalDockerRuntime({confirmation:'OBSERVE_LOCAL_DOCKER_ONLY',architecture:'amd64',imageIds});
 const lookup=id=>requestLocalDockerJson(socket,'/images/'+id+'/json');
 const before=await observe();
 assert.equal(before.runtime_state,'LOCAL_LINUX_DAEMON_OBSERVED');
 assert.ok(before.images.every(x=>x.state==='NOT_FOUND'));
 const baseline=await ids();
 for(const id of Object.values(imageIds))assert.ok(!baseline.includes(id));
 const prepared=await prepareOfflineDockerArchive({...input,confirmation:'PREPARE_UNTAGGED_OFFLINE_DOCKER_ARCHIVE_ONLY',destinationParent});
 const receipt=await verifyPreparedDockerArchive({...input,confirmation:'VERIFY_PREPARED_DOCKER_ARCHIVE_ONLY',
  archivePath:prepared.archive_path,expectedArchiveSha256:prepared.archive_sha256});
 assert.equal(receipt.archive_readback_verified,true);assert.deepEqual(receipt.expected_image_ids,imageIds);
 try{
  await docker('image','load','--input',prepared.archive_path);
  const loaded=await observe();assert.equal(loaded.all_expected_image_ids_observed,true);
  assert.equal(loaded.installation_authorized,false);
  for(const e of Object.values(expected)){
   const actual=await lookup(e.id);assert.equal(actual.missing,false);verifySyntheticLoadedImage(e,actual.value);
  }
  assert.deepEqual(await ids(),[...baseline,...Object.values(imageIds)].sort());
 }finally{
  // No force/prune and never remove pre-existing or unexpectedly tagged IDs.
  for(const e of Object.values(expected)){
   const actual=await lookup(e.id);
   if(!actual.missing){verifySyntheticLoadedImage(e,actual.value);await docker('image','rm',e.id)}
  }
  const after=await observe();assert.ok(after.images.every(x=>x.state==='NOT_FOUND'));
  assert.deepEqual(await ids(),baseline);
 }
 console.log('PASS: synthetic signed two-layer archive loaded, exact three image IDs and ordered diff IDs observed, untagged images removed, original image inventory preserved; no containers executed.');
},[layer('app/fixture.txt',65),layer('app/fixture.txt',66)]);
