// Read-only Linux reference host checks. No runtime selection, installation,
// socket binding, DNS lookup, database access or environment-secret reads.
import os from 'node:os';
import {constants} from 'node:fs';
import {lstat,realpath,statfs,open} from 'node:fs/promises';
import {resolve} from 'node:path';
const validPort=p=>Number.isInteger(p)&&p>=1&&p<=65535;
const validMin=n=>Number.isSafeInteger(n)&&n>0;
const unknown=()=>({state:'UNKNOWN'});
function check(id,state) { return {id,state}; }
export function parseLinuxListeningPorts(text) {
  const lines=text.trim().split(/\r?\n/);
  if (!lines[0]?.includes('local_address') || !lines[0]?.includes('st')) throw Error('UNKNOWN_TCP_TABLE');
  const ports=new Set();
  for(const line of lines.slice(1)) {
    const fields=line.trim().split(/\s+/);
    if(!/^\d+:$/.test(fields[0]) || !/^(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{32}):[0-9A-Fa-f]{4}$/.test(fields[1]) ||
      !/^[0-9A-Fa-f]{2}$/.test(fields[3])) throw Error('UNKNOWN_TCP_TABLE');
    if(fields[3].toUpperCase()==='0A') ports.add(parseInt(fields[1].split(':')[1],16));
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
    return Buffer.concat(pieces).toString('ascii');
  } finally {await f.close()}
}
async function observePath(path) {
  // A missing marker is not proof that a service or DB does not exist.
  const p=resolve(path);
  try {
    const st=await lstat(p);
    if(st.isSymbolicLink()||await realpath(p)!==p) return 'UNKNOWN';
    return 'PRESENT';
  } catch(e) {return e.code==='ENOENT'?'NOT_OBSERVED':'UNKNOWN'}
}
export async function inspectLanHost({targetDirectory,markerPaths,ports,minCpu,minMemoryBytes,minFreeBytes}) {
  if(typeof targetDirectory!=='string'||!targetDirectory||
     !Array.isArray(ports)||ports.length<1||ports.length>32||
     !ports.every(validPort)||new Set(ports).size!==ports.length||
     ![minCpu,minMemoryBytes,minFreeBytes].every(validMin)||
     !markerPaths||Object.keys(markerPaths).length!==3||
     !['database','credentials','service'].every(k=>typeof markerPaths[k]==='string'&&markerPaths[k])) throw Error('EXPLICIT_HOST_POLICY_REQUIRED');
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
      listening=new Set([...parseLinuxListeningPorts(await readProc('/proc/net/tcp')),
        ...parseLinuxListeningPorts(await readProc('/proc/net/tcp6'))]);
    } catch {}
  }
  const portChecks=ports.map(port=>({port,state:listening===null?'UNKNOWN':
    listening.has(port)?'LISTENER_OBSERVED':'NO_LISTENER_OBSERVED'}));
  const markers={};
  for(const key of ['database','credentials','service']) markers[key]=await observePath(markerPaths[key]);
  return Object.freeze({schema_version:1,decision:'EXTERNAL_APPROVAL_REQUIRED',
    checks,ports:portChecks,markers,
    runtime_compatibility_verified:false,resource_absence_verified:false,
    port_reservation_verified:false,installation_authorized:false});
}
