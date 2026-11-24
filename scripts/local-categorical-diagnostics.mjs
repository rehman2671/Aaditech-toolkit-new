// Read-only local operator reference collectors. No remote invocation,
// active network probes, hardware interrogation, commands or file writes.
import {constants} from 'node:fs';
import {open,lstat,realpath,statfs} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const interfaceName=x=>typeof x==='string'&&x.length>=1&&x.length<=15&&
 /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(x)&&!/[\r\n]/.test(x);
const fail=()=>{throw Error('EXPLICIT_LOCAL_DIAGNOSTIC_POLICY_REQUIRED')};
function result(doc){
 const artifact=Buffer.from(JSON.stringify(doc));
 return Object.freeze({artifact,artifact_sha256:createHash('sha256').update(artifact).digest('hex'),
  measured_fields:Object.entries(doc).filter(([k,v])=>k!=='schema'&&v!==null&&v!=='NOT_RUN').length,
  collection_scope:'LOCAL_OPERATOR_REFERENCE',measurement_truth_verified:false,
  remote_execution_authorized:false,production_accepted:false});
}
async function readBounded(path,max){
 const f=await open(path,constants.O_RDONLY|(constants.O_NONBLOCK||0));
 try{
  const bytes=Buffer.alloc(max+1);let n=0;
  while(n<bytes.length){const {bytesRead}=await f.read(bytes,n,bytes.length-n,null);if(!bytesRead)break;n+=bytesRead}
  if(n>max)throw Error('LOCAL_OBSERVATION_LIMIT');
  return bytes.subarray(0,n).toString('ascii');
 }finally{await f.close()}
}
export function parseLinuxIPv4DefaultRoute(text,name){
 if(!interfaceName(name)||typeof text!=='string'||text.length>256*1024||
    /[^\x09\x0a\x0d\x20-\x7e]/.test(text))throw Error('ROUTE_TABLE_INVALID');
 const lines=text.trim().split(/\r?\n/);
 const header=lines.shift()?.trim().split(/\s+/);
 if(header?.join(' ')!=='Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT')throw Error('ROUTE_TABLE_INVALID');
 let found=false,seen=false;
 for(const line of lines){
  const f=line.trim().split(/\s+/);
  if(f.length!==11||!interfaceName(f[0])||![f[1],f[2],f[7]].every(x=>/^[0-9A-Fa-f]{8}$/.test(x))||
     !/^[0-9A-Fa-f]{4}$/.test(f[3])||![f[4],f[5],f[6],f[8],f[9],f[10]].every(x=>/^\d+$/.test(x)))throw Error('ROUTE_TABLE_INVALID');
  if(f[0]===name){seen=true;if(f[1]==='00000000'&&f[7]==='00000000'&&(parseInt(f[3],16)&1)!==0&&
    (parseInt(f[3],16)&0x200)===0)found=true}
 }
 // This is only the selected interface in the kernel IPv4 route table.
 // No route rows for that interface cannot establish overall connectivity.
 return found?'PRESENT':seen?'ABSENT':null;
}
export async function collectLocalNetworkDiagnostic({confirmation,interfaceId}={}){
 if(confirmation!=='COLLECT_LOCAL_NETWORK_ONLY'||!interfaceName(interfaceId))fail();
 let link=null,route=null;
 if(process.platform==='linux'){
  try{
   const state=(await readBounded('/sys/class/net/'+interfaceId+'/operstate',64)).trim();
   if(state==='up')link='UP';else if(['down','lowerlayerdown','notpresent'].includes(state))link='DOWN';
  }catch{}
  try{route=parseLinuxIPv4DefaultRoute(await readBounded('/proc/net/route',256*1024),interfaceId)}catch{}
 }
 return result({schema:'aaditech-network-diagnostic-v1',link_state:link,
  default_route_state:route,approved_probe_state:'NOT_RUN'});
}
export async function collectLocalDiskDiagnostic({confirmation,targetDirectory}={}){
 if(confirmation!=='COLLECT_LOCAL_DISK_ONLY'||typeof targetDirectory!=='string'||
    !isAbsolute(targetDirectory)||targetDirectory.includes('\0'))fail();
 let free=null;const path=resolve(targetDirectory);
 try{
  const before=await lstat(path);
  if(before.isDirectory()&&!before.isSymbolicLink()&&await realpath(path)===path){
   const fs=await statfs(path,{bigint:true}),after=await lstat(path);
   if(after.isDirectory()&&!after.isSymbolicLink()&&before.dev===after.dev&&before.ino===after.ino&&
      await realpath(path)===path&&fs.blocks>0n&&fs.bavail>=0n&&fs.bavail<=fs.blocks)
    free=Number(fs.bavail*10000n/fs.blocks)/100;
  }
 }catch{}
 // statfs capacity cannot establish SMART health or read-only mount status.
 return result({schema:'aaditech-disk-diagnostic-v1',free_percent:free,
  health_state:null,read_only_state:null});
}
