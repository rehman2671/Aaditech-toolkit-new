// Local operator-only read-only reference collector. Never register as a
// remote command or HTTP route. No network, files written, or user inventory.
import os from 'node:os';
import {lstat,realpath,statfs} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
const percent=(part,total)=>typeof part==='bigint'&&typeof total==='bigint'&&total>0n&&part>=0n&&part<=total
 ? Number(part*10000n/total)/100 : null;
const timeKeys=['user','nice','sys','idle','irq'];
function cpuSnapshot(){
 const cpus=os.cpus();
 if(!Array.isArray(cpus)||!cpus.length||cpus.length>4096)return null;
 return cpus.map(c=>timeKeys.map(k=>c?.times?.[k]));
}
function cpuDelta(a,b){
 if(!a||!b||a.length!==b.length)return null;
 let total=0n,idle=0n;
 for(let i=0;i<a.length;i++)for(let j=0;j<timeKeys.length;j++){
  const x=a[i][j],y=b[i][j];
  if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||x<0||y<x)return null;
  const d=BigInt(y)-BigInt(x);total+=d;if(timeKeys[j]==='idle')idle+=d;
 }
 return percent(total-idle,total);
}
async function diskUsage(path){
 try{
  const before=await lstat(path);
  if(!before.isDirectory()||before.isSymbolicLink()||await realpath(path)!==path)return null;
  const fs=await statfs(path,{bigint:true});
  const after=await lstat(path);
  if(!after.isDirectory()||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||
     await realpath(path)!==path)return null;
  // Used blocks, including filesystem reserved space as free if reported
  // by bfree. Not the same as space available to an unprivileged process.
  return percent(fs.blocks-fs.bfree,fs.blocks);
 }catch{return null}
}
export async function collectLocalResourceDiagnostic({confirmation,targetDirectory,sampleMs=250}={}){
 if(confirmation!=='COLLECT_LOCAL_RESOURCE_ONLY'||typeof targetDirectory!=='string'||
    !isAbsolute(targetDirectory)||targetDirectory.includes('\0')||
    !Number.isInteger(sampleMs)||sampleMs<100||sampleMs>2000)throw Error('EXPLICIT_LOCAL_RESOURCE_POLICY_REQUIRED');
 const path=resolve(targetDirectory);
 let cpu=null,ram=null;
 // No names, addresses, paths, raw counters or device identifiers are
 // included in the artifact. A failed observation is null, not zero.
 try{const first=cpuSnapshot();await delay(sampleMs);cpu=cpuDelta(first,cpuSnapshot())}catch{}
 try{
  const total=os.totalmem(),free=os.freemem();
  if(Number.isSafeInteger(total)&&Number.isSafeInteger(free)&&free>=0&&free<=total)
   ram=percent(BigInt(total-free),BigInt(total));
 }catch{}
 const disk=await diskUsage(path);
 const artifact=Buffer.from(JSON.stringify({schema:'aaditech-resource-diagnostic-v1',
  cpu_percent:cpu,ram_percent:ram,disk_percent:disk}));
 return Object.freeze({artifact,artifact_sha256:createHash('sha256').update(artifact).digest('hex'),
  measured_fields:[cpu,ram,disk].filter(x=>x!==null).length,measurement_truth_verified:false,
  collection_scope:'LOCAL_OPERATOR_REFERENCE',remote_execution_authorized:false,production_accepted:false});
}
