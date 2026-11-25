// Explicit local operator native OCI image import, never a web API.
// Requires exclusive daemon/custody control and independently approved pins.
// No pull, tags, containers, removal, prune, or automatic retry.
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {request} from 'node:http';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createHash} from 'node:crypto';
import {verifyNativeOciArchive} from './verify-native-oci-archive.mjs';
import {socketIdentity,requestLocalDockerJson,inspectLocalDockerRuntime} from './local-docker-runtime-preflight.mjs';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const fail=()=>{throw Error('NATIVE_OCI_IMPORT_UNCONFIRMED')};
const socket='/run/docker.sock';
const same=(a,b)=>['dev','ino','uid','mode','size','nlink','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const exact=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Reflect.ownKeys(o).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
export function validateNativeStore(info,architecture){
 const i=info?.value;
 if(info?.missing!==false||i?.OSType!=='linux'||typeof i.ID!=='string'||i.ID.length<1||i.ID.length>256||!['amd64','arm64'].includes(architecture)||
  !(architecture==='amd64'?['x86_64','amd64']:['aarch64','arm64']).includes(i.Architecture)||
  !Array.isArray(i.DriverStatus)||!i.DriverStatus.some(x=>Array.isArray(x)&&x[0]==='driver-type'&&x[1]==='io.containerd.snapshotter.v1'))fail();
 return i.ID;
}
export function verifyImportedNativeImage(response,image,architecture){
 const v=response?.value;
 if(response?.missing!==false||v?.Id!==image.manifest_id||v.Os!=='linux'||v.Architecture!==architecture||
  !(v.RepoTags===null||Array.isArray(v.RepoTags)&&v.RepoTags.length===0)||v.RootFS?.Type!=='layers'||!Array.isArray(v.RootFS.Layers)||
  JSON.stringify(v.RootFS.Layers)!==JSON.stringify(image.diff_ids))fail();
 return true;
}
async function loadArchive(fd,size,expected){
 const hash=createHash('sha256');let count=0;
 const measure=new Transform({transform(chunk,_enc,cb){count+=chunk.length;if(count>size)return cb(Error('NATIVE_OCI_IMPORT_UNCONFIRMED'));hash.update(chunk);cb(null,chunk)}});
 let req,timer;
 const response=new Promise((resolve,reject)=>{
  req=request({socketPath:socket,path:'/images/load?quiet=1',method:'POST',agent:false,headers:{Host:'localhost','Content-Type':'application/x-tar','Content-Length':String(size),Connection:'close'}},res=>{
   if(res.statusCode!==200||res.headers['content-encoding']!==undefined){res.destroy();reject(Error('NATIVE_OCI_IMPORT_UNCONFIRMED'));return}
   let n=0;const chunks=[];res.on('error',reject);res.on('aborted',()=>reject(Error('NATIVE_OCI_IMPORT_UNCONFIRMED')));
   res.on('data',c=>{n+=c.length;if(n>1048576){res.destroy();reject(Error('NATIVE_OCI_IMPORT_UNCONFIRMED'))}else chunks.push(c)});
   res.on('end',()=>{try{
    if(!res.complete)fail();
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
    for(const line of raw.split('\n').filter(x=>x.trim())){rejectDuplicateJsonKeys(line);const row=JSON.parse(line);if(!row||typeof row!=='object'||Array.isArray(row)||Object.hasOwn(row,'error')||Object.hasOwn(row,'errorDetail'))fail()}
    resolve();
   }catch(e){reject(e)}});
  });
  req.on('error',reject);timer=setTimeout(()=>req.destroy(Error('NATIVE_OCI_IMPORT_DEADLINE')),300000);
 });
 try{await Promise.all([pipeline(fd.createReadStream({autoClose:false,start:0,end:size-1}),measure,req),response]);if(count!==size||hash.digest('hex')!==expected)fail()}
 finally{clearTimeout(timer);req?.destroy()}
}
export async function importNativeOciArchive(input){
 if(!exact(input,['confirmation','lockRoot','admission'])||input.confirmation!=='IMPORT_PINNED_NATIVE_OCI_IMAGES_ONLY_EXCLUSIVE_DAEMON_CUSTODY')fail();
 const p=structuredClone(input.admission),lockRoot=input.lockRoot;
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot},async()=>{
  const verified=await verifyNativeOciArchive(p),identity=await socketIdentity();
  const get=async route=>{const r=await requestLocalDockerJson(socket,route);if(JSON.stringify(await socketIdentity())!==JSON.stringify(identity))fail();return r};
  const daemon=validateNativeStore(await get('/info'),p.architecture);
  const policy={confirmation:'OBSERVE_LOCAL_DOCKER_ONLY',architecture:p.architecture,imageIds:verified.expected_manifest_ids};
  const before=await inspectLocalDockerRuntime(policy);
  if(before.runtime_state!=='LOCAL_LINUX_DAEMON_OBSERVED'||!before.images.every(x=>x.state==='NOT_FOUND'))fail();
  const fd=await open(p.archivePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const st=await fd.stat();if(!st.isFile()||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o600||st.nlink!==1||st.size!==p.archiveBytes||!same(st,await lstat(p.archivePath)))fail();
   // Reverify path while the read-only descriptor is held, then recheck inode.
   const again=await verifyNativeOciArchive(p);if(JSON.stringify(again)!==JSON.stringify(verified)||!same(st,await fd.stat())||!same(st,await lstat(p.archivePath)))fail();
   if(validateNativeStore(await get('/info'),p.architecture)!==daemon)fail();
   for(const image of verified.images)if((await get('/images/'+image.manifest_id+'/json')).missing!==true)fail();
   await loadArchive(fd,p.archiveBytes,p.archiveSha256);
   if(!same(st,await fd.stat())||!same(st,await lstat(p.archivePath)))fail();
   for(const image of verified.images)verifyImportedNativeImage(await get('/images/'+image.manifest_id+'/json'),image,p.architecture);
   if(validateNativeStore(await get('/info'),p.architecture)!==daemon)fail();
  }finally{await fd.close()}
  const after=await verifyNativeOciArchive(p);if(JSON.stringify(after)!==JSON.stringify(verified))fail();
  return {archive_sha256:verified.archive_sha256,expected_manifest_ids:verified.expected_manifest_ids,images_imported:true,expected_ids_observed:true,ordered_layer_diff_ids_observed:true,untagged_images_observed:true,container_execution_performed:false,installation_authorized:false,production_accepted:false};
 });
}
