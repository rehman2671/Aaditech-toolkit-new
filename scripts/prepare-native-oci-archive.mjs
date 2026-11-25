// Local native OCI archive preparation from independently pinned signed stage.
// No daemon load, extraction, service execution, or production approval.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdtemp,chmod,rm,statfs} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectOfflineOciRuntime} from './inspect-offline-oci-runtime.mjs';
import {canonicalDockerArchiveHeader} from './prepare-offline-docker-archive.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const fail=()=>{throw Error('NATIVE_OCI_ARCHIVE_UNVERIFIED')};
const sha=b=>createHash('sha256').update(b).digest('hex');
const pathOk=p=>typeof p==='string'&&p.length<=4096&&isAbsolute(p)&&resolve(p)===p&&!/[\x00-\x1f\x7f]/.test(p);
const within=(a,b)=>{const p=relative(a,b);return !p||(!isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+sep))};
const keys=['dev','ino','uid','mode','size','nlink','mtimeMs','ctimeMs'],dirKeys=keys.slice(0,4);
const same=(a,b,k=keys)=>k.every(x=>a[x]===b[x]);
const pad=n=>(512-n%512)%512;
async function directory(p,old){const s=await lstat(p);if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(p)!==p||(old&&!same(s,old,dirKeys)))fail();return s}
async function syncDir(p,s){const f=await open(p,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{if(!same(s,await f.stat(),dirKeys))fail();await f.sync()}finally{await f.close()}}
async function streamPinned(path,size,expected,consume){
 const st=await lstat(path);if(!st.isFile()||st.nlink!==1||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o600||st.size!==size||await realpath(path)!==path)fail();
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),hash=createHash('sha256');
 try{if(!same(st,await f.stat()))fail();const b=Buffer.alloc(1024*1024);let at=0;while(at<size){const r=await f.read(b,0,Math.min(b.length,size-at),at);if(!r.bytesRead)fail();const chunk=b.subarray(0,r.bytesRead);hash.update(chunk);await consume(chunk);at+=r.bytesRead}
  if(hash.digest('hex')!==expected||!same(st,await f.stat())||!same(st,await lstat(path)))fail();
 }finally{await f.close()}
}
function header(name,size){
 if(!/^(?:index\.json|oci-layout|blobs\/sha256\/[a-f0-9]{64})$/.test(name))fail();
 const h=canonicalDockerArchiveHeader('member',size);h.fill(0,0,100);h.write(name,0,'ascii');h.fill(32,148,156);h.write(h.reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148,'ascii');return h;
}
export async function prepareNativeOciArchive(input={}){
 const {confirmation,stagedDirectory,destinationParent,trustedManifestSha256,trustedPublicKeyPem,trustedSignerSpkiSha256,architecture}=input;
 if(confirmation!=='PREPARE_NATIVE_OCI_ARCHIVE_ONLY'||process.platform!=='linux'||typeof process.geteuid!=='function'||!pathOk(stagedDirectory)||!pathOk(destinationParent)||within(stagedDirectory,destinationParent)||within(destinationParent,stagedDirectory))fail();
 const pins={confirmation:'INSPECT_SIGNED_OCI_RUNTIME_ONLY',stagedDirectory,trustedManifestSha256,trustedPublicKeyPem,trustedSignerSpkiSha256,architecture};
 const parent=await directory(destinationParent),release=await inspectOfflineOciRuntime(pins);
 if(!release.release_signature_verified||!release.strict_ustar_profile_verified||!release.cross_layer_path_profile_verified)fail();
 const mp=join(stagedDirectory,'manifest.json'),ms=await lstat(mp);if(ms.size<1||ms.size>2*1024*1024)fail();
 const parts=[];await streamPinned(mp,ms.size,trustedManifestSha256,b=>parts.push(Buffer.from(b)));
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));rejectDuplicateJsonKeys(raw);
 const entries=JSON.parse(raw).files.filter(x=>x.path.startsWith('runtime/')).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(entries.length<5||entries.length>400||new Set(entries.map(x=>x.path)).size!==entries.length)fail();
 let total=1024;
 for(const e of entries){if(!/^runtime\/(?:index\.json|oci-layout|blobs\/sha256\/[a-f0-9]{64})$/.test(e.path)||!Number.isSafeInteger(e.size)||e.size<1||e.size>0o77777777777||! /^[a-f0-9]{64}$/.test(e.sha256))fail();total+=512+e.size+pad(e.size);if(total>33*1024**3)fail()}
 const fs=await statfs(destinationParent,{bigint:true});if(fs.bavail*fs.bsize<BigInt(total+1048576))fail();
 await directory(destinationParent,parent);let stage,st,f;
 try{
  stage=await mkdtemp(join(destinationParent,'native-oci-'));await chmod(stage,0o700);st=await directory(stage);
  const output=join(stage,'runtime-oci.tar');f=await open(output,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await f.chmod(0o600);
  let count=0;const hash=createHash('sha256');const write=async b=>{if(count+b.length>total)fail();let n=0;while(n<b.length){const r=await f.write(b,n,b.length-n,count+n);if(!r.bytesWritten)fail();n+=r.bytesWritten}count+=b.length;hash.update(b)};
  for(const e of entries){await write(header(e.path.slice(8),e.size));await streamPinned(join(stagedDirectory,'payload',e.path),e.size,e.sha256,write);await write(Buffer.alloc(pad(e.size)))}
  await write(Buffer.alloc(1024));if(count!==total)fail();await f.sync();const written=await f.stat();if(written.size!==total||!same(written,await lstat(output)))fail();await f.close();f=null;
  const final=await inspectOfflineOciRuntime(pins);if(JSON.stringify(final)!==JSON.stringify(release)||!same(written,await lstat(output)))fail();
  await syncDir(stage,st);await syncDir(destinationParent,parent);
  return {archive_path:output,archive_sha256:hash.digest('hex'),archive_bytes:total,expected_manifest_ids:Object.fromEntries(release.images.map(x=>[x.role,x.manifest_digest])),expected_config_ids:Object.fromEntries(release.images.map(x=>[x.role,x.image_config_id])),native_oci_archive_prepared:true,image_imported:false,production_accepted:false};
 }catch(e){if(f)await f.close();if(stage&&st){await directory(destinationParent,parent);await directory(stage,st);await rm(stage,{recursive:true,force:true});await syncDir(destinationParent,parent)}throw e}
}
