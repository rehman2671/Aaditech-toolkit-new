// Disposable fixture only, never accepts external paths, image IDs or commands.
// Three static test images: no registry pull, network, volume or host mounts.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,realpath,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {operateExistingComposeServices,inspectExistingComposeRecovery} from '../scripts/local-compose-service-lifecycle.mjs';
import {switchQuiescentComposeConfiguration} from '../scripts/switch-runtime-configuration.mjs';
if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.platform!=='linux'||process.arch!=='x64')throw Error('DISPOSABLE_GITHUB_RUNNER_REQUIRED');
const root=await mkdtemp(join(await realpath(tmpdir()),'aaditech-lifecycle-')),project='at_fixture_'+randomUUID().replaceAll('-',''),roles=['db','api','caddy'];
const env={PATH:'/usr/bin:/bin',HOME:process.env.HOME||'/tmp'};
function run(binary,args,timeout=120000){const x=spawnSync(binary,args,{encoding:'utf8',timeout,maxBuffer:1048576,env});if(x.status!==0||x.error)throw Error('FIXTURE_COMMAND_FAILED');return x.stdout.trim()}
const docker=(...a)=>run('/usr/bin/docker',['--host','unix:///run/docker.sock',...a]);
const images=[],created=[],containers={};
const hash=x=>createHash('sha256').update(x).digest('hex');
try{
 const fsroot=join(root,'rootfs'),lockRoot=join(root,'lock'),failedLock=join(root,'failed-lock'),configDir=join(root,'config');
 await mkdir(fsroot);await mkdir(join(fsroot,'bin'));for(const d of [lockRoot,failedLock,configDir])await mkdir(d,{mode:0o700});
 const src=join(root,'fixture.c'),bin=join(fsroot,'fixture'),archive=join(root,'fixture.tar');
 await writeFile(src,`#include <signal.h>
#include <string.h>
#include <unistd.h>
static void finish(int sig){(void)sig;_exit(0);}
int main(int argc,char **argv){
 if(argc==3 && !strcmp(argv[1],"-c") && !strcmp(argv[2],"/fixture health"))return 0;
 if(argc==2 && !strcmp(argv[1],"health"))return 0;
 signal(SIGTERM,finish);signal(SIGINT,finish);
 for(;;)pause();
}
`);
 run('/usr/bin/cc',['-static','-O2','-o',bin,src]);
 run('/usr/bin/cp',[bin,join(fsroot,'bin','sh')]);run('/usr/bin/tar',['--format=ustar','-C',fsroot,'-cf',archive,'fixture','bin/sh']);
 for(const role of roles){
  const image=docker('image','import','--change','LABEL aaditech.fixture='+project+'-'+role,archive);
  assert.match(image,/^sha256:[a-f0-9]{64}$/);images.push(image);
  const args=['container','create','--pull','never','--network','none','--read-only','--cap-drop','ALL','--label','com.docker.compose.project='+project,'--label','com.docker.compose.service='+role,'--label','com.docker.compose.oneoff=False','--label','aaditech.fixture='+project];
  if(role!=='caddy')args.push('--health-cmd','/fixture health','--health-interval','1s','--health-timeout','2s','--health-retries','3');
  const id=docker(...args,image,'/fixture');assert.match(id,/^[a-f0-9]{64}$/);created.push(id);
  containers[role]={containerId:id,imageId:image};
 }
 const observe=(lock=lockRoot)=>inspectExistingComposeRecovery({confirmation:'INSPECT_PINNED_EXISTING_COMPOSE_RECOVERY_ONLY',project,lockRoot:lock,containers});
 const operate=(operation,lock=lockRoot)=>operateExistingComposeServices({confirmation:operation==='start'?'START_PINNED_EXISTING_COMPOSE_CONTAINERS_ONLY':'STOP_PINNED_EXISTING_COMPOSE_CONTAINERS_ONLY',operation,project,lockRoot:lock,containers});
 assert.equal((await observe()).observed_state,'ALL_EXISTING_CONTAINERS_STOPPED');
 assert.equal((await operate('start')).services.every(x=>x.state==='running'),true);
 assert.equal((await observe()).observed_state,'ALL_EXISTING_CONTAINERS_RUNNING');
 const old='SERVER_HOST=old.example.com\nCADDY_HOST=old.example.com\nDB_PASSWORD=fixture\n',next=old.replaceAll('old.example.com','new.example.com'),activePath=join(configDir,'.env');
 await writeFile(activePath,old,{mode:0o600});await writeFile(join(configDir,'.env.candidate'),next,{mode:0o600});
 const configuration={confirmation:'SWITCH_CONFIGURATION_FILE_ONLY_SERVICES_QUIESCED',operation:'activate',profile:'compose',activePath,lockRoot,originalSha256:hash(old),candidateSha256:hash(next),changes:{serverHost:'new.example.com'}};
 const guarded=config=>switchQuiescentComposeConfiguration({confirmation:'SWITCH_PINNED_QUIESCENT_COMPOSE_FILE_ONLY',configuration:config,project,containers});
 await assert.rejects(()=>guarded({...configuration,lockRoot:failedLock}));assert.equal(await readFile(activePath,'utf8'),old);
 assert.equal((await observe(failedLock)).observed_state,'MANUAL_RECONCILIATION_REQUIRED');
 assert.equal((await operate('stop')).services.every(x=>x.state==='exited'),true);
 assert.equal((await guarded(configuration)).existing_container_quiescence_observed,true);assert.equal(await readFile(activePath,'utf8'),next);
 assert.equal((await guarded({...configuration,operation:'rollback',confirmation:'RESTORE_CONFIGURATION_FILE_ONLY_SERVICES_QUIESCED'})).active_sha256,hash(old));assert.equal(await readFile(activePath,'utf8'),old);
 assert.equal((await observe()).observed_state,'ALL_EXISTING_CONTAINERS_STOPPED');
 docker('container','start',containers.db.containerId);for(let i=0;i<20;i++){if(docker('container','inspect','--format','{{.State.Health.Status}}',containers.db.containerId)==='healthy')break;await new Promise(r=>setTimeout(r,1000))}assert.equal((await observe()).observed_state,'PARTIAL_OR_UNHEALTHY_STATE');
 const partialLock=join(root,'partial-lock');await mkdir(partialLock,{mode:0o700});await assert.rejects(()=>operate('start',partialLock));assert.equal((await observe(partialLock)).observed_state,'MANUAL_RECONCILIATION_REQUIRED');
 console.log('PASS: disposable fixture actual container lifecycle, quiescent file switch and rollback, partial-state denial and retained lock; no production acceptance.');
}finally{
 // Only exact container IDs created in this process and exact fixture image
 // IDs. No prune, volume deletion, tag removal or unrelated resources.
 for(const id of created.reverse())docker('container','rm','-f',id);
 for(const id of images.reverse())docker('image','rm',id);
 await rm(root,{recursive:true,force:true});
}
