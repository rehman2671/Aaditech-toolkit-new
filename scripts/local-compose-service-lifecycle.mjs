// Explicit lifecycle of three EXISTING Compose containers only.
// Does not create/recreate, change environment, build, pull, remove volumes,
// run commands inside containers, or establish deployment acceptance.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {socketIdentity,requestLocalDockerJson} from './local-docker-runtime-preflight.mjs';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const exec=promisify(execFile),binary='/usr/bin/docker',socket='/run/docker.sock';
const fail=()=>{throw Error('LOCAL_SERVICE_LIFECYCLE_UNCONFIRMED')};
const roles=['db','api','caddy'];
const exact=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Reflect.ownKeys(o).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
export function validateLifecyclePolicy(input){
 if(!exact(input,['confirmation','operation','project','lockRoot','containers'])||!['start','stop'].includes(input.operation)||input.confirmation!==(input.operation==='start'?'START_PINNED_EXISTING_COMPOSE_CONTAINERS_ONLY':'STOP_PINNED_EXISTING_COMPOSE_CONTAINERS_ONLY')||typeof input.project!=='string'||!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(input.project)||!exact(input.containers,roles))fail();
 const containers={};
 for(const k of roles){const c=input.containers[k];if(!exact(c,['containerId','imageId'])||!hex(c.containerId)||typeof c.imageId!=='string'||!c.imageId.startsWith('sha256:')||!hex(c.imageId.slice(7)))fail();containers[k]={...c}}
 if(new Set(roles.map(k=>containers[k].containerId)).size!==3)fail();
 return {operation:input.operation,project:input.project,lockRoot:input.lockRoot,containers};
}
export function classifyExistingContainer(doc,policy,role){
 const c=policy.containers[role],l=doc?.Config?.Labels,s=doc?.State;
 if(!c||doc.Id!==c.containerId||doc.Image!==c.imageId||l?.['com.docker.compose.project']!==policy.project||l?.['com.docker.compose.service']!==role||String(l?.['com.docker.compose.oneoff']).toLowerCase()!=='false'||!s||typeof s.Running!=='boolean'||s.Paused!==false||s.Restarting!==false||s.Dead!==false||!['running','exited','created'].includes(s.Status)||s.Running!==(s.Status==='running'))fail();
 if(role!=='caddy'&&(!Array.isArray(doc.Config?.Healthcheck?.Test)||!doc.Config.Healthcheck.Test.length||doc.Config.Healthcheck.Test[0]==='NONE'))fail();
 return {role,state:s.Status,health:s.Running?(s.Health?.Status??'NOT_CONFIGURED'):'NOT_RUNNING'};
}
async function assertBinary(){const s=await lstat(binary);if(!s.isFile()||s.uid!==0||(s.mode&0o022)!==0||(s.mode&0o111)===0||await realpath(binary)!==binary)fail();return [s.dev,s.ino,s.uid,s.mode,s.size,s.mtimeMs,s.ctimeMs]}
export async function operateExistingComposeServices(input){
 const p=validateLifecyclePolicy(input);
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:p.lockRoot},async()=>{
  const binaryId=await assertBinary(),socketId=await socketIdentity();
  const info=await requestLocalDockerJson(socket,'/info'),daemon=info?.value?.ID;
  if(info?.missing!==false||typeof daemon!=='string'||!daemon||info.value.OSType!=='linux')fail();
  async function continuity(){
   if(JSON.stringify(await assertBinary())!==JSON.stringify(binaryId)||JSON.stringify(await socketIdentity())!==JSON.stringify(socketId))fail();
   const d=await requestLocalDockerJson(socket,'/info');if(d?.missing!==false||d.value?.ID!==daemon||d.value?.OSType!=='linux')fail();
  }
  async function run(args,timeout=30000){
   await continuity();
   let r;try{r=await exec(binary,['--host','unix:///run/docker.sock',...args],{encoding:'utf8',timeout,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_CONFIG:'/nonexistent'}})}catch{fail()}
   await continuity();return r.stdout;
  }
  async function inspect(role){
   const raw=await run(['container','inspect',p.containers[role].containerId]);rejectDuplicateJsonKeys(raw);const a=JSON.parse(raw);if(!Array.isArray(a)||a.length!==1)fail();return classifyExistingContainer(a[0],p,role);
  }
  const initial=[];for(const role of roles)initial.push(await inspect(role));
  if(p.operation==='start'&&!initial.every(x=>x.state==='exited'||x.state==='created'))fail();
  if(p.operation==='stop'&&!initial.every(x=>x.state==='running'))fail();
  const order=p.operation==='start'?roles:[...roles].reverse();
  for(const role of order){
   const before=await inspect(role);
   if(p.operation==='start'){
    if(!['exited','created'].includes(before.state))fail();
    await run(['container','start',p.containers[role].containerId],60000);
    const deadline=Date.now()+120000;
    while(true){
     const state=await inspect(role);
     if(state.state==='running'&&(role==='caddy'||state.health==='healthy'))break;
     if(state.state!=='running'||state.health==='unhealthy'||Date.now()>deadline)fail();
     await sleep(2000);
    }
   }else{
    if(before.state!=='running')fail();
    await run(['container','stop','--time','30',p.containers[role].containerId],60000);
    if((await inspect(role)).state!=='exited')fail();
   }
  }
  const final=[];for(const role of roles)final.push(await inspect(role));
  if(p.operation==='start'?!final.every(x=>x.state==='running'&&(x.role==='caddy'||x.health==='healthy')):!final.every(x=>x.state==='exited'))fail();
  return {operation:p.operation,services:final,existing_containers_only:true,configuration_recreated:false,network_health_verified:false,database_identity_verified:false,production_accepted:false};
 });
}
