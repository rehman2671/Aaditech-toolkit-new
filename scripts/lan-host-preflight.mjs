// Read-only Linux reference host checks. No runtime selection, installation,
// socket binding, DNS lookup, database access or environment-secret reads.
import os from 'node:os';
import {constants} from 'node:fs';
import {lstat,realpath,statfs,open} from 'node:fs/promises';
import {resolve,dirname,isAbsolute} from 'node:path';
const validPort=p=>Number.isInteger(p)&&p>=1&&p<=65535;
const validMin=n=>Number.isSafeInteger(n)&&n>0;
const validPath=p=>typeof p==='string'&&p.length>0&&p.length<=4096&&
  !/[\x00-\x1f\x7f]/.test(p)&&isAbsolute(p)&&resolve(p)===p;
const markerKeys=['database','credentials','service'];
const policyKeys=['targetDirectory','markerPaths','ports','minCpu','minMemoryBytes','minFreeBytes'];
const ownData=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);return !!d&&d.enumerable&&Object.hasOwn(d,'value')};
const exactRecord=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(o))&&
  Reflect.ownKeys(o).length===keys.length&&keys.every(k=>ownData(o,k));
const densePorts=p=>Array.isArray(p)&&p.length>=1&&p.length<=32&&
  Reflect.ownKeys(p).length===p.length+1&&
  Array.from({length:p.length},(_,i)=>String(i)).every(k=>ownData(p,k))&&
  p.every(validPort)&&new Set(p).size===p.length;
const unknown=()=>({state:'UNKNOWN'});
function check(id,state) { return {id,state}; }
export function parseLinuxListeningPorts(text,expectedAddressLength=null) {
  const fail=()=>{throw Error('UNKNOWN_TCP_TABLE')};
  if(typeof text!=='string'||text.length>4*1024*1024||
    /[^\x09\x0a\x0d\x20-\x7e]/.test(text)||/\r(?!\n)/.test(text)||
    ![null,8,32].includes(expectedAddressLength))fail();
  const lines=text.trim().split(/\r?\n/);
  const header=lines[0].trim().split(/\s+/);
  if(header[0]!=='sl'||header[1]!=='local_address'||
    !['rem_address','remote_address'].includes(header[2])||header[3]!=='st')fail();
  const ports=new Set();
  let addressLength=expectedAddressLength;
  for(const line of lines.slice(1)) {
    const fields=line.trim().split(/\s+/);
    if(!/^\d+:$/.test(fields[0])||
      !/^(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{32}):[0-9A-Fa-f]{4}$/.test(fields[1])||
      !/^(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{32}):[0-9A-Fa-f]{4}$/.test(fields[2])||
      !/^(?:0[1-9A-Da-d])$/.test(fields[3]))fail();
    const [local,port]=fields[1].split(':'),[remote,remotePort]=fields[2].split(':');
    addressLength??=local.length;
    if(local.length!==addressLength||remote.length!==addressLength)fail();
    if(fields[3].toUpperCase()==='0A'){
      if(port==='0000'||!/^[0]+$/.test(remote)||remotePort!=='0000')fail();
      ports.add(parseInt(port,16));
    }
  }
  return ports;
}
async function readProc(path) {
  const f=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);
  try {
    const pieces=[];let total=0;const buf=Buffer.alloc(8192);
    for(;;) {
      const {bytesRead}=await f.read(buf,0,buf.length,null);
      if(!bytesRead) break;
      total+=bytesRead;
      if(total>4*1024*1024) throw Error('TCP_TABLE_LIMIT');
      pieces.push(Buffer.from(buf.subarray(0,bytesRead)));
    }
    return Buffer.concat(pieces).toString('latin1');
  } finally {await f.close()}
}
async function observePath(p) {
  // A missing leaf is only an observation, and only when its nearest
  // existing ancestor is a real canonical directory, not a symlink.
  try {
    const st=await lstat(p);
    if(st.isSymbolicLink()||await realpath(p)!==p) return 'UNKNOWN';
    return 'PRESENT';
  } catch(e) {
    if(e.code!=='ENOENT')return 'UNKNOWN';
    let parent=dirname(p);
    for(let depth=0;depth<64;depth++){
      try{
        const st=await lstat(parent);
        return st.isDirectory()&&!st.isSymbolicLink()&&await realpath(parent)===parent?'NOT_OBSERVED':'UNKNOWN';
      }catch(err){
        if(err.code!=='ENOENT'||dirname(parent)===parent)return 'UNKNOWN';
        parent=dirname(parent);
      }
    }
    return 'UNKNOWN';
  }
}
export async function inspectLanHost(policy) {
  if(!exactRecord(policy,policyKeys)||!exactRecord(policy.markerPaths,markerKeys)||
     !validPath(policy.targetDirectory)||!densePorts(policy.ports)||
     ![policy.minCpu,policy.minMemoryBytes,policy.minFreeBytes].every(validMin)||
     !markerKeys.every(k=>validPath(policy.markerPaths[k]))||
     new Set(markerKeys.map(k=>policy.markerPaths[k])).size!==markerKeys.length)
    throw Error('EXPLICIT_HOST_POLICY_REQUIRED');
  const {targetDirectory,minCpu,minMemoryBytes,minFreeBytes}=policy;
  const ports=[...policy.ports],markerPaths={...policy.markerPaths};
  const checks=[];
  const supported=process.platform==='linux';
  checks.push(check('reference_platform',supported?'OBSERVED_LINUX':'UNKNOWN'));
  checks.push(check('privilege',supported&&typeof process.geteuid==='function'?
    (process.geteuid()===0?'ROOT_OBSERVED':'NOT_ROOT'):'UNKNOWN'));
  const cpu=os.availableParallelism(),mem=os.totalmem();
  checks.push(check('cpu',cpu>=minCpu?'MEETS_INPUT_THRESHOLD':'INSUFFICIENT'));
  checks.push(check('physical_memory',mem>=minMemoryBytes?'MEETS_INPUT_THRESHOLD':'INSUFFICIENT'));
  let disk=unknown();
  try {
    const p=resolve(targetDirectory),st=await lstat(p);
    if(st.isDirectory()&&!st.isSymbolicLink()&&await realpath(p)===p) {
      const fs=await statfs(p,{bigint:true});
      const available=fs.bavail*fs.bsize;
      disk={state:available>=BigInt(minFreeBytes)?'MEETS_INPUT_THRESHOLD':'INSUFFICIENT'};
    }
  } catch {}
  checks.push(check('disk',disk.state));
  let listening=null;
  if(supported) {
    try {
      listening=new Set([...parseLinuxListeningPorts(await readProc('/proc/net/tcp'),8),
        ...parseLinuxListeningPorts(await readProc('/proc/net/tcp6'),32)]);
    } catch {}
  }
  const portChecks=ports.map(port=>({port,state:listening===null?'UNKNOWN':
    listening.has(port)?'LISTENER_OBSERVED':'NO_LISTENER_OBSERVED'}));
  const markers={};
  for(const key of ['database','credentials','service']) markers[key]=await observePath(markerPaths[key]);
  return Object.freeze({schema_version:1,decision:'EXTERNAL_APPROVAL_REQUIRED',
    checks:Object.freeze(checks.map(Object.freeze)),ports:Object.freeze(portChecks.map(Object.freeze)),markers:Object.freeze(markers),
    runtime_compatibility_verified:false,resource_absence_verified:false,
    port_reservation_verified:false,installation_authorized:false});
}
