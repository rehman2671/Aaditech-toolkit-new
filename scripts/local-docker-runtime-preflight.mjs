// Read-only reference for the existing Linux Docker candidate, not an ADR.
// No Docker CLI, shell, environment endpoint, pull, load, create, start,
// remote TCP, host secret output or authorization. Trusted root-owned daemon
// and local host namespace required. Image IDs are config digests, not
// registry manifest digests, publisher signatures or independent byte proofs.
import {request} from 'node:http';
import {lstat,realpath} from 'node:fs/promises';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const fail=code=>{throw Error(code)};
const socketPath='/run/docker.sock';
const validId=v=>typeof v==='string'&&v.length===71&&/^sha256:[a-f0-9]{64}$/.test(v)&&!/^sha256:0+$/.test(v);
const roles=['api','database','ingress'];
const architectures=['amd64','arm64'];
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 [Object.prototype,null].includes(Object.getPrototypeOf(x))&&Reflect.ownKeys(x).length===keys.length&&
 keys.every(k=>{const d=Object.getOwnPropertyDescriptor(x,k);return d?.enumerable&&Object.hasOwn(d,'value')});
export function validateDockerObservationPolicy(input){
 if(!exact(input,['confirmation','architecture','imageIds'])||
 input.confirmation!=='OBSERVE_LOCAL_DOCKER_ONLY'||!architectures.includes(input.architecture)||
 !exact(input.imageIds,roles)||!roles.every(k=>validId(input.imageIds[k]))||
 new Set(roles.map(k=>input.imageIds[k])).size!==roles.length)fail('DOCKER_OBSERVATION_POLICY_INVALID');
 return Object.freeze({architecture:input.architecture,imageIds:Object.freeze(Object.fromEntries(roles.map(k=>[k,input.imageIds[k]])))});
}
const allowedRoute=route=>route==='/version'||route==='/info'||
 (typeof route==='string'&&route.startsWith('/images/')&&route.endsWith('/json')&&validId(route.slice(8,-5)));
const maxBody=1024*1024;
// Exported solely as a bounded transport seam for trusted local tests. The
// production observer always supplies the fixed, inspected socket above.
export function requestLocalDockerJson(path,route){
 if(typeof path!=='string'||!path.startsWith('/')||path.length>4096||path.includes('\0')||!allowedRoute(route))
  return Promise.reject(Error('DOCKER_OBSERVATION_ROUTE_INVALID'));
 return new Promise((resolve,reject)=>{
  let settled=false,timer;
  const finish=(err,value)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   if(err)reject(err);else resolve(value);
  };
  const req=request({socketPath:path,path:route,method:'GET',agent:false,
   headers:{Host:'localhost',Accept:'application/json',Connection:'close'}},res=>{
    res.on('error',()=>finish(Error('DOCKER_OBSERVATION_TRANSPORT_UNVERIFIED')));
    res.on('aborted',()=>finish(Error('DOCKER_OBSERVATION_TRANSPORT_UNVERIFIED')));
    if(res.statusCode===404&&route.startsWith('/images/')){finish(null,{missing:true});res.destroy();return}
    if(res.statusCode!==200||typeof res.headers['content-type']!=='string'||
       !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(res.headers['content-type'])||
       res.headers['content-encoding']!==undefined){
     finish(Error('DOCKER_OBSERVATION_RESPONSE_UNVERIFIED'));res.destroy();return;
    }
    const declared=res.headers['content-length'];
    if(declared!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(declared)||Number(declared)>maxBody)){
     finish(Error('DOCKER_OBSERVATION_RESPONSE_UNVERIFIED'));res.destroy();return;
    }
    let total=0;const parts=[];
    res.on('data',chunk=>{
     total+=chunk.length;
     if(total>maxBody){finish(Error('DOCKER_OBSERVATION_RESPONSE_UNVERIFIED'));res.destroy();return}
     parts.push(chunk);
    });
    res.on('end',()=>{
     try{
      if(!res.complete||!total||(declared!==undefined&&Number(declared)!==total))throw Error();
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));
      rejectDuplicateJsonKeys(raw);const value=JSON.parse(raw);
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
      finish(null,{missing:false,value});
     }catch{finish(Error('DOCKER_OBSERVATION_RESPONSE_UNVERIFIED'))}
    });
   });
  req.on('error',()=>finish(Error('DOCKER_OBSERVATION_TRANSPORT_UNVERIFIED')));
  timer=setTimeout(()=>{finish(Error('DOCKER_OBSERVATION_DEADLINE'));req.destroy()},4000);
  req.end();
 });
}
const apiVersion=v=>typeof v==='string'&&/^1\.(0|[1-9][0-9]{0,2})$/.test(v);
export function classifyDockerRuntimeObservation(policy,version,info,images){
 const p=validateDockerObservationPolicy(policy);
 const v=version?.value,i=info?.value;
 const runtimeObserved=version?.missing===false&&info?.missing===false&&v?.Os==='linux'&&
  v.Arch===p.architecture&&apiVersion(v.ApiVersion)&&i?.OSType==='linux'&&
  ((p.architecture==='amd64'&&['x86_64','amd64'].includes(i.Architecture))||
   (p.architecture==='arm64'&&['aarch64','arm64'].includes(i.Architecture)))&&
  typeof i.ID==='string'&&i.ID.length>=1&&i.ID.length<=256;
 const rows=roles.map(role=>{
  const response=images?.[role],image=response?.value;
  const state=response?.missing===true?'NOT_FOUND':response?.missing===false&&image?.Id===p.imageIds[role]&&
   image.Os==='linux'&&image.Architecture===p.architecture?'PINNED_ID_OBSERVED':'UNVERIFIED';
  return Object.freeze({role,state});
 });
 const all=runtimeObserved&&rows.every(x=>x.state==='PINNED_ID_OBSERVED');
 return Object.freeze({schema_version:1,decision:all?'EXTERNAL_REVIEW_REQUIRED':'BLOCKED',
  runtime_state:runtimeObserved?'LOCAL_LINUX_DAEMON_OBSERVED':'UNVERIFIED',
  images:Object.freeze(rows),all_expected_image_ids_observed:all,
  image_payload_integrity_verified:false,publisher_signature_verified:false,actual_resource_absence_verified:false,
  runtime_compatibility_verified:false,offline_execution_verified:false,installation_authorized:false,production_accepted:false});
}
async function socketIdentity(){
 if(process.platform!=='linux'||typeof process.geteuid!=='function')fail('LOCAL_DOCKER_SOCKET_UNVERIFIED');
 const dir=await lstat('/run'),socket=await lstat(socketPath);
 if(!dir.isDirectory()||dir.uid!==0||(dir.mode&0o022)!==0||await realpath('/run')!=='/run'||
    !socket.isSocket()||socket.uid!==0||(socket.mode&0o7000)!==0||(socket.mode&0o002)!==0||
    await realpath(socketPath)!==socketPath)fail('LOCAL_DOCKER_SOCKET_UNVERIFIED');
 return [dir.dev,dir.ino,dir.uid,dir.mode,socket.dev,socket.ino,socket.uid,socket.gid,socket.mode];
}
export async function inspectLocalDockerRuntime(input){
 const p=validateDockerObservationPolicy(input);
 const before=await socketIdentity();
 const get=async route=>{
  const result=await requestLocalDockerJson(socketPath,route);
  const after=await socketIdentity();
  if(before.some((v,i)=>v!==after[i]))fail('LOCAL_DOCKER_SOCKET_CHANGED');
  return result;
 };
 const version=await get('/version'),info=await get('/info');
 const images={};
 for(const role of roles)images[role]=await get('/images/'+p.imageIds[role]+'/json');
 // A final daemon identity observation catches common daemon replacement,
 // not a malicious local root or all concurrent daemon state changes.
 const last=await get('/info');
 if(info.value?.ID!==last.value?.ID||info.value?.OSType!==last.value?.OSType||
    info.value?.Architecture!==last.value?.Architecture)fail('LOCAL_DOCKER_DAEMON_CHANGED');
 return classifyDockerRuntimeObservation({confirmation:'OBSERVE_LOCAL_DOCKER_ONLY',...p},version,info,images);
}
