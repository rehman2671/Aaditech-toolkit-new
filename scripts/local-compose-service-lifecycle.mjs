// Explicit lifecycle of three EXISTING Compose containers only.
// Does not create/recreate, change environment, build, pull, remove volumes,
// run commands inside containers, or establish deployment acceptance.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath,readdir} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {socketIdentity,requestLocalDockerJson} from './local-docker-runtime-preflight.mjs';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const exec=promisify(execFile),binary='/usr/bin/docker',socket='/run/docker.sock';
const fail=()=>{throw Error('LOCAL_SERVICE_LIFECYCLE_UNCONFIRMED')};
const roles=['db','api','caddy'];
const exact=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Reflect.ownKeys(o).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const pathOk=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const projectOk=x=>typeof x==='string'&&x.length>=1&&x.length<=48&&/^[a-z0-9][a-z0-9_-]*$/.test(x)&&!/[\r\n]/.test(x);
export function validateLifecyclePolicy(input){
 if(!exact(input,['confirmation','operation','project','lockRoot','containers'])||!['start','stop'].includes(input.operation)||input.confirmation!==(input.operation==='start'?'START_PINNED_EXISTING_COMPOSE_CONTAINERS_ONLY':'STOP_PINNED_EXISTING_COMPOSE_CONTAINERS_ONLY')||!projectOk(input.project)||!pathOk(input.lockRoot)||!exact(input.containers,roles))fail();
 const containers={};
 for(const k of roles){const c=input.containers[k];if(!exact(c,['containerId','imageId'])||!hex(c.containerId)||typeof c.imageId!=='string'||!c.imageId.startsWith('sha256:')||!hex(c.imageId.slice(7)))fail();containers[k]={...c}}
 if(new Set(roles.map(k=>containers[k].containerId)).size!==3||new Set(roles.map(k=>containers[k].imageId)).size!==3)fail();
 return {operation:input.operation,project:input.project,lockRoot:input.lockRoot,containers};
}
export function classifyExistingContainer(doc,policy,role){
 const c=policy.containers[role],l=doc?.Config?.Labels,s=doc?.State;
 if(!c||doc.Id!==c.containerId||doc.Image!==c.imageId||l?.['com.docker.compose.project']!==policy.project||l?.['com.docker.compose.service']!==role||typeof l?.['com.docker.compose.oneoff']!=='string'||l['com.docker.compose.oneoff'].toLowerCase()!=='false'||!s||typeof s.Running!=='boolean'||s.Paused!==false||s.Restarting!==false||s.Dead!==false||!['running','exited','created'].includes(s.Status)||s.Running!==(s.Status==='running'))fail();
 if(role!=='caddy'&&(!Array.isArray(doc.Config?.Healthcheck?.Test)||doc.Config.Healthcheck.Test.length<2||!['CMD','CMD-SHELL'].includes(doc.Config.Healthcheck.Test[0])||doc.Config.Healthcheck.Test.some(x=>typeof x!=='string'||!x.length)))fail();
 const health=s.Running?(s.Health?.Status??'NOT_CONFIGURED'):'NOT_RUNNING';
 if(s.Running&&(!['healthy','starting','unhealthy','NOT_CONFIGURED'].includes(health)||(role!=='caddy'&&health==='NOT_CONFIGURED')))fail();
 return {role,state:s.Status,health};
}
async function assertBinary(){const s=await lstat(binary);if(!s.isFile()||s.uid!==0||(s.mode&0o022)!==0||(s.mode&0o111)===0||await realpath(binary)!==binary)fail();return [s.dev,s.ino,s.uid,s.mode,s.size,s.mtimeMs,s.ctimeMs]}
export async function operateExistingComposeServices(input){
 const p=validateLifecyclePolicy(input);
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:p.lockRoot},async({assertHeld})=>{
  const {inspect,run}=await openLifecycleObservation(p,assertHeld);
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
     if(state.state==='running'&&((role==='caddy'&&state.health==='NOT_CONFIGURED')||state.health==='healthy'))break;
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
  if(p.operation==='start'?!final.every(x=>x.state==='running'&&((x.role==='caddy'&&x.health==='NOT_CONFIGURED')||x.health==='healthy')):!final.every(x=>x.state==='exited'))fail();
  return {operation:p.operation,services:final,existing_containers_only:true,configuration_recreated:false,network_health_verified:false,database_identity_verified:false,production_accepted:false};
 });
}

// Fixed Docker transport, never accepts commands from operator input.
async function openLifecycleObservation(p,assertHeld){
  await assertHeld();
  const binaryId=await assertBinary(),socketId=await socketIdentity();
  const info=await requestLocalDockerJson(socket,'/info'),daemon=info?.value?.ID;
  if(info?.missing!==false||typeof daemon!=='string'||!daemon||info.value.OSType!=='linux')fail();
  async function continuity(){
   await assertHeld();
   if(JSON.stringify(await assertBinary())!==JSON.stringify(binaryId)||JSON.stringify(await socketIdentity())!==JSON.stringify(socketId))fail();
   const d=await requestLocalDockerJson(socket,'/info');if(d?.missing!==false||d.value?.ID!==daemon||d.value?.OSType!=='linux')fail();
   await assertHeld();
  }
  async function run(args,timeout=30000){
   await continuity();
   let r;try{r=await exec(binary,['--host','unix:///run/docker.sock',...args],{encoding:'utf8',timeout,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_CONFIG:'/nonexistent'}})}catch{fail()}
   await continuity();return r.stdout;
  }
  async function inspect(role){
   const raw=await run(['container','inspect',p.containers[role].containerId]);rejectDuplicateJsonKeys(raw);const a=JSON.parse(raw);if(!Array.isArray(a)||a.length!==1)fail();return classifyExistingContainer(a[0],p,role);
  }
  return {inspect,run};
}

// A read-only inspector intentionally does not acquire, remove or recover
// the cooperative lock. Lock presence always blocks a resume conclusion.
export function classifyLifecycleRecovery(rows,lockEntriesPresent){
 if(typeof lockEntriesPresent!=='boolean'||!Array.isArray(rows)||rows.length!==3||
  rows.some((x,i)=>!exact(x,['role','state','health'])||x.role!==roles[i]||
  !['created','exited','running'].includes(x.state)||
  (x.state==='running'?(!['healthy','starting','unhealthy','NOT_CONFIGURED'].includes(x.health)||(x.role!=='caddy'&&x.health==='NOT_CONFIGURED')):x.health!=='NOT_RUNNING')))fail();
 const stopped=rows.every(x=>x.state!=='running');
 const healthy=rows.every(x=>x.state==='running'&&(x.role==='caddy'?['healthy','NOT_CONFIGURED'].includes(x.health):x.health==='healthy'));
 const observed_state=lockEntriesPresent?'MANUAL_RECONCILIATION_REQUIRED':stopped?'ALL_EXISTING_CONTAINERS_STOPPED':healthy?'ALL_EXISTING_CONTAINERS_RUNNING':'PARTIAL_OR_UNHEALTHY_STATE';
 return {observed_state,services:rows.map(x=>({...x})),lock_entries_present:lockEntriesPresent,files_changed:false,containers_changed:false,lock_removed:false,resume_authorized:false,rollback_authorized:false,configuration_verified:false,database_identity_verified:false,network_health_verified:false,production_accepted:false};
}
export async function inspectExistingComposeRecovery(input){
 if(!exact(input,['confirmation','project','lockRoot','containers'])||input.confirmation!=='INSPECT_PINNED_EXISTING_COMPOSE_RECOVERY_ONLY')fail();
 const p=validateLifecyclePolicy({...input,operation:'start',confirmation:'START_PINNED_EXISTING_COMPOSE_CONTAINERS_ONLY'});
 const root=p.lockRoot;
 async function lockSnapshot(){
  const s=await lstat(root);
  if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(root)!==root)fail();
  const names=await readdir(root);if(names.length>100)fail();
  return {identity:[s.dev,s.ino,s.uid,s.mode,s.mtimeMs,s.ctimeMs],names:names.sort()};
 }
 const first=await lockSnapshot(),assertUnchanged=async()=>{if(JSON.stringify(await lockSnapshot())!==JSON.stringify(first))fail()};
 const {inspect}=await openLifecycleObservation(p,assertUnchanged);
 const a=[],b=[];for(const role of roles)a.push(await inspect(role));for(const role of roles)b.push(await inspect(role));
 if(JSON.stringify(a)!==JSON.stringify(b))fail();await assertUnchanged();
 return classifyLifecycleRecovery(a,first.names.length>0);
}

/** Trusted local caller only; caller must hold the same setup lock during
 * both observations and file publication. No Docker mutation. */
export async function openQuiescentComposeGuard(input,assertHeld){
 if(typeof assertHeld!=='function'||!exact(input,['confirmation','project','lockRoot','containers'])||input.confirmation!=='VERIFY_PINNED_COMPOSE_QUIESCENCE_ONLY')fail();
 const policy=validateLifecyclePolicy({...input,confirmation:'START_PINNED_EXISTING_COMPOSE_CONTAINERS_ONLY',operation:'start'});
 const {inspect}=await openLifecycleObservation(policy,assertHeld);
 const check=async()=>{
  await assertHeld();
  const a=[],b=[];for(const role of roles)a.push(await inspect(role));for(const role of roles)b.push(await inspect(role));
  if(JSON.stringify(a)!==JSON.stringify(b)||!a.every(x=>['created','exited'].includes(x.state)&&x.health==='NOT_RUNNING'))fail();
  await assertHeld();
 };
 await check();return check;
}
