// Convert the narrow publisher-signed OCI profile to an untagged Docker
// load archive. Writes only a unique private local directory. No daemon
// mutation, layer extraction, merged-rootfs proof or install authorization.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdtemp,chmod,rm,statfs} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectOfflineOciRuntime,verifyGzipLayerFile} from './inspect-offline-oci-runtime.mjs';
const fail=()=>{throw Error('OFFLINE_DOCKER_ARCHIVE_UNVERIFIED')};
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const pathOk=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const within=(a,b)=>{const p=relative(a,b);return !p||(!isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+sep))};
const fields=['dev','ino','uid','mode','size','nlink','mtimeMs','ctimeMs'];
const same=(a,b,keys=fields)=>keys.every(k=>a[k]===b[k]);
const pad=n=>(512-n%512)%512;
const maxArchive=33*1024**3;
export function dockerArchiveMemberHeader(name,size){
 if(typeof name!=='string'||name.length>100||!/^[a-z0-9.-]+$/.test(name)||
   !Number.isSafeInteger(size)||size<0||size>0o77777777777)fail();
 const h=Buffer.alloc(512);
 h.write(name,0,'ascii');
 const field=(n,start,width)=>h.write(n.toString(8).padStart(width-1,'0')+'\0',start,'ascii');
 field(0o600,100,8);field(0,108,8);field(0,116,8);field(size,124,12);field(0,136,12);
 h.fill(32,148,156);h[156]=48;h.write('ustar\0',257,'ascii');h.write('00',263,'ascii');
 h.write(h.reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148,'ascii');
 return h;
}
async function privateDirectory(path,old){
 if(!pathOk(path))fail();
 const s=await lstat(path);
 if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(path)!==path||
   (old&&!same(s,old,['dev','ino','uid','mode'])))fail();
 return s;
}
async function syncDirectory(path,old){
 const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{if(!same(await fd.stat(),old,['dev','ino','uid','mode']))fail();await fd.sync()}finally{await fd.close()}
}
async function configBytes(path,size,expected){
 if(!hex(expected)||!Number.isSafeInteger(size)||size<1||size>1024*1024)fail();
 const st=await lstat(path);
 if(!st.isFile()||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o600||st.nlink!==1||st.size!==size)fail();
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(st,await fd.stat()))fail();
  const bytes=Buffer.alloc(size+1);let n=0;
  while(n<bytes.length){const r=await fd.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==size||!same(st,await fd.stat())||!same(st,await lstat(path)))fail();
  const body=bytes.subarray(0,n);
  if(createHash('sha256').update(body).digest('hex')!==expected)fail();
  return body;
 }finally{await fd.close()}
}
// Pure plan from a verified internal receipt. Never accept this plan as
// release authority; prepareOfflineDockerArchive always reinspects bytes.
export function planDockerArchive(release){
 if(!release||!Array.isArray(release.images)||release.images.length!==3)fail();
 const configs=new Map(),layers=new Map(),manifest=[],roles=new Set();
 for(const image of release.images){
  if(!['api','database','ingress'].includes(image.role)||roles.has(image.role)||
   typeof image.image_config_id!=='string'||!image.image_config_id.startsWith('sha256:')||
   !hex(image.image_config_id.slice(7))||!Number.isSafeInteger(image.config_bytes)||
   image.config_bytes<1||image.config_bytes>1024*1024||
   !Array.isArray(image.layers)||image.layers.length<1||image.layers.length>128)fail();
  roles.add(image.role);
  const config=image.image_config_id.slice(7),name='config-'+config+'.json';
  if(configs.has(name))fail();configs.set(name,{digest:config,size:image.config_bytes});
  const paths=[];
  for(const layer of image.layers){
   if(!hex(layer.blob_sha256)||typeof layer.diff_id!=='string'||!layer.diff_id.startsWith('sha256:')||
      !hex(layer.diff_id.slice(7))||!Number.isSafeInteger(layer.compressed_bytes)||layer.compressed_bytes<1||
      layer.compressed_bytes>64*1024**3||!Number.isSafeInteger(layer.uncompressed_bytes)||
      layer.uncompressed_bytes<1||layer.uncompressed_bytes>8*1024**3)fail();
   const member='layer-'+layer.blob_sha256+'.tar',old=layers.get(member);
   if(old&&['diff_id','compressed_bytes','uncompressed_bytes'].some(k=>old[k]!==layer[k]))fail();
   if(!old)layers.set(member,{...layer});
   paths.push(member);
  }
  manifest.push({Config:name,RepoTags:[],Layers:paths});
 }
 const manifestBytes=Buffer.from(JSON.stringify(manifest));
 const sizes=[...configs.values()].map(x=>x.size).concat([...layers.values()].map(x=>x.uncompressed_bytes),manifestBytes.length);
 const archiveBytes=sizes.reduce((n,size)=>n+512+size+pad(size),1024);
 if(!Number.isSafeInteger(archiveBytes)||archiveBytes>maxArchive)fail();
 return {configs,layers,manifestBytes,archiveBytes};
}
export async function prepareOfflineDockerArchive(input={}){
 const {confirmation,destinationParent,stagedDirectory,trustedManifestSha256,trustedPublicKeyPem,trustedSignerSpkiSha256,architecture}=input;
 if(confirmation!=='PREPARE_UNTAGGED_OFFLINE_DOCKER_ARCHIVE_ONLY'||process.platform!=='linux'||
   typeof process.geteuid!=='function'||!constants.O_NOFOLLOW||!pathOk(destinationParent)||!pathOk(stagedDirectory)||
   within(destinationParent,stagedDirectory)||within(stagedDirectory,destinationParent))fail();
 const pins={confirmation:'INSPECT_SIGNED_OCI_RUNTIME_ONLY',stagedDirectory,trustedManifestSha256,trustedPublicKeyPem,trustedSignerSpkiSha256,architecture};
 const parent=await privateDirectory(destinationParent);
 const release=await inspectOfflineOciRuntime(pins),plan=planDockerArchive(release);
 const fs=await statfs(destinationParent,{bigint:true});
 if(fs.bavail<0n||fs.bsize<=0n||fs.bavail*fs.bsize<BigInt(plan.archiveBytes+1048576))fail();
 await privateDirectory(destinationParent,parent);
 let stage,stageStat,fd;
 try{
  stage=await mkdtemp(join(destinationParent,'docker-archive-'));await chmod(stage,0o700);
  stageStat=await privateDirectory(stage);
  const output=join(stage,'runtime.tar');
  fd=await open(output,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await fd.chmod(0o600);let count=0;const hash=createHash('sha256');
  const write=async b=>{
   if(count+b.length>plan.archiveBytes)fail();
   let n=0;while(n<b.length){const r=await fd.write(b,n,b.length-n,count+n);if(!r.bytesWritten)fail();n+=r.bytesWritten}
   count+=b.length;hash.update(b);
  };
  const member=async(name,bytes)=>{await write(dockerArchiveMemberHeader(name,bytes.length));await write(bytes);await write(Buffer.alloc(pad(bytes.length)))};
  const blobs=join(stagedDirectory,'payload','runtime','blobs','sha256');
  for(const [name,c] of plan.configs)await member(name,await configBytes(join(blobs,c.digest),c.size,c.digest));
  for(const [name,l] of plan.layers){
   await write(dockerArchiveMemberHeader(name,l.uncompressed_bytes));
   const n=await verifyGzipLayerFile(join(blobs,l.blob_sha256),{size:l.compressed_bytes,sha256:l.blob_sha256},l.diff_id,l.uncompressed_bytes,true,write);
   if(n!==l.uncompressed_bytes)fail();await write(Buffer.alloc(pad(n)));
  }
  await member('manifest.json',plan.manifestBytes);await write(Buffer.alloc(1024));
  if(count!==plan.archiveBytes)fail();await fd.sync();
  const written=await fd.stat();
  if(written.size!==count||!same(written,await lstat(output)))fail();
  await fd.close();fd=null;
  const final=await inspectOfflineOciRuntime(pins);
  if(JSON.stringify(final)!==JSON.stringify(release)||!same(written,await lstat(output)))fail();
  await syncDirectory(stage,stageStat);await syncDirectory(destinationParent,parent);
  return Object.freeze({schema_version:1,archive_path:output,archive_sha256:hash.digest('hex'),archive_bytes:count,
    approved_manifest_sha256:release.approved_manifest_sha256,
    expected_image_ids:Object.freeze(Object.fromEntries(release.images.map(x=>[x.role,x.image_config_id]))),
    untagged_archive_prepared:true,cross_layer_path_profile_verified:true,image_imported:false,merged_rootfs_verified:false,installation_authorized:false,production_accepted:false});
 }catch(e){
  if(fd)await fd.close();
  if(stage&&stageStat){await privateDirectory(destinationParent,parent);await privateDirectory(stage,stageStat);await rm(stage,{recursive:true,force:true});await syncDirectory(destinationParent,parent)}
  throw e;
 }
}
