// POSIX local operator-only artifact retention. No signing, transport,
// remote collection, attempt acceptance or automatic retention/deletion.
import {constants} from 'node:fs';
import {open,lstat,realpath,unlink,link} from 'node:fs/promises';
import {resolve,isAbsolute,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Error(code)};
const percent=v=>v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100);
const category=(...allowed)=>v=>v===null||allowed.includes(v);
const contracts=Object.freeze({
 'aaditech-resource-diagnostic-v1':{cpu_percent:percent,ram_percent:percent,disk_percent:percent},
 'aaditech-network-diagnostic-v1':{link_state:category('UP','DOWN'),default_route_state:category('PRESENT','ABSENT'),approved_probe_state:category('NOT_RUN')},
 'aaditech-disk-diagnostic-v1':{free_percent:percent,health_state:category(),read_only_state:category()},
 'aaditech-battery-diagnostic-v1':{charge_percent:percent,charging_state:category('CHARGING','DISCHARGING','FULL','NOT_CHARGING'),capacity_percent:percent}
});
function validate(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>512)fail('LOCAL_ARTIFACT_INVALID');
 const snapshot=Buffer.from(bytes);let doc;
 try{doc=JSON.parse(snapshot.toString('utf8'))}catch{fail('LOCAL_ARTIFACT_INVALID')}
 if(!doc||typeof doc!=='object'||Array.isArray(doc)||!Object.hasOwn(contracts,doc.schema))fail('LOCAL_ARTIFACT_INVALID');
 const fields=contracts[doc.schema],keys=Object.keys(fields);
 if(!keys.every(k=>Object.hasOwn(doc,k)&&fields[k](doc[k])))fail('LOCAL_ARTIFACT_INVALID');
 const canonical=Buffer.from(JSON.stringify({schema:doc.schema,...Object.fromEntries(keys.map(k=>[k,doc[k]]))}));
 if(!snapshot.equals(canonical))fail('LOCAL_ARTIFACT_INVALID');
 return snapshot;
}
async function privateDirectory(directory){
 if(typeof process.geteuid!=='function'||!constants.O_NOFOLLOW||typeof directory!=='string'||!isAbsolute(directory))fail('PRIVATE_ARTIFACT_DIRECTORY_REQUIRED');
 const dir=resolve(directory),st=await lstat(dir);
 if(!st.isDirectory()||st.uid!==process.geteuid()||(st.mode&0o777)!==0o700||await realpath(dir)!==dir)fail('PRIVATE_ARTIFACT_DIRECTORY_REQUIRED');
 return {dir,st};
}
async function assertDirectory(dir,st){
 const current=await lstat(dir);
 if(!current.isDirectory()||current.dev!==st.dev||current.ino!==st.ino||current.uid!==st.uid||(current.mode&0o777)!==0o700||await realpath(dir)!==dir)fail('ARTIFACT_DIRECTORY_CHANGED');
}
export async function retainLocalDiagnosticArtifact({confirmation,directory,artifact,expectedArtifactSha256}={}){
 if(confirmation!=='RETAIN_LOCAL_DIAGNOSTIC_ONLY')fail('EXPLICIT_LOCAL_RETENTION_REQUIRED');
 const bytes=validate(artifact),digest=sha(bytes);
 if(expectedArtifactSha256!==digest)fail('LOCAL_ARTIFACT_DIGEST_MISMATCH');
 // A trusted private local directory and exclusive operator custody are
 // required. Path checks are not a defense against a hostile same-UID writer.
 const {dir,st}=await privateDirectory(directory);
 const dest=join(dir,digest+'.json'),temp=join(dir,'.artifact-'+randomUUID()+'.tmp');
 let fd,created=false;
 try{
  fd=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  created=true;await fd.chmod(0o600);await fd.writeFile(bytes);await fd.sync();await fd.close();fd=null;
  await assertDirectory(dir,st);
  try{await link(temp,dest)}catch(e){if(e.code==='EEXIST')fail('LOCAL_ARTIFACT_ALREADY_RETAINED');throw e}
 }finally{if(fd)await fd.close();if(created)await unlink(temp)}
 const d=await open(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{
  const actual=await d.stat();
  if(actual.dev!==st.dev||actual.ino!==st.ino)fail('ARTIFACT_DIRECTORY_CHANGED');
  await d.sync();
 }finally{await d.close()}
 await assertDirectory(dir,st);
 return Object.freeze({artifact_retained:true,artifact_sha256:digest,signature_verified:false,
  measurement_truth_verified:false,attempt_accepted:false,production_accepted:false});
}

export async function readRetainedLocalDiagnosticArtifact({confirmation,directory,expectedArtifactSha256}={}){
 if(confirmation!=='READ_LOCAL_DIAGNOSTIC_ONLY'||typeof expectedArtifactSha256!=='string'||
    expectedArtifactSha256.length!==64||!/^[a-f0-9]{64}$/.test(expectedArtifactSha256))fail('EXPLICIT_LOCAL_READ_REQUIRED');
 const {dir,st}=await privateDirectory(directory),path=join(dir,expectedArtifactSha256+'.json');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await fd.stat();
  if(!before.isFile()||before.nlink!==1||before.uid!==process.geteuid()||
     (before.mode&0o777)!==0o600||before.size<1||before.size>512)fail('LOCAL_ARTIFACT_FILE_INVALID');
  const buffer=Buffer.alloc(before.size+1);let n=0;
  while(n<buffer.length){const {bytesRead}=await fd.read(buffer,n,buffer.length-n,n);if(!bytesRead)break;n+=bytesRead}
  const after=await fd.stat(),current=await lstat(path);
  if(n!==before.size||[after,current].some(x=>!x.isFile()||x.nlink!==1||
    ['dev','ino','size','mtimeMs','ctimeMs','mode','uid'].some(k=>x[k]!==before[k])))fail('LOCAL_ARTIFACT_CHANGED');
  const artifact=validate(buffer.subarray(0,n));
  if(sha(artifact)!==expectedArtifactSha256)fail('LOCAL_ARTIFACT_DIGEST_MISMATCH');
  await assertDirectory(dir,st);
  return Object.freeze({artifact,artifact_sha256:expectedArtifactSha256,integrity_verified:true,
   signature_verified:false,measurement_truth_verified:false,attempt_accepted:false,production_accepted:false});
 }finally{await fd.close()}
}
