// Independent native OCI archive admission against original signed stage.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {dirname,basename,isAbsolute,resolve,relative,sep,join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectOfflineOciRuntime} from './inspect-offline-oci-runtime.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {canonicalDockerArchiveHeader} from './prepare-offline-docker-archive.mjs';
const fail=()=>{throw Error('NATIVE_OCI_ARCHIVE_ADMISSION_UNVERIFIED')};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const sha=b=>createHash('sha256').update(b).digest('hex');
const pathOk=p=>typeof p==='string'&&p.length<=4096&&isAbsolute(p)&&resolve(p)===p&&!/[\x00-\x1f\x7f]/.test(p);
const within=(a,b)=>{const p=relative(a,b);return !p||(!isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+sep))};
const keys=['confirmation','archivePath','archiveSha256','archiveBytes','stagedDirectory','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256','architecture'];
const fields=['dev','ino','uid','mode','size','nlink','mtimeMs','ctimeMs'];
const same=(a,b,k=fields)=>k.every(x=>a[x]===b[x]);
const exact=(o,ks)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Reflect.ownKeys(o).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)??{},'value'));
async function dir(p){const s=await lstat(p);if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(p)!==p)fail();return s}
async function custody(p,n){
 const root=await dir(dirname(dirname(p))),parent=await dir(dirname(p)),file=await lstat(p);
 if(!file.isFile()||file.uid!==process.geteuid()||(file.mode&0o7777)!==0o600||file.nlink!==1||file.size!==n||await realpath(p)!==p)fail();
 return {root,parent,file};
}
const sameCustody=(a,b)=>same(a.root,b.root,['dev','ino','uid','mode','mtimeMs','ctimeMs'])&&same(a.parent,b.parent,['dev','ino','uid','mode','mtimeMs','ctimeMs'])&&same(a.file,b.file);
async function manifestEntries(p){
 const f=await open(join(p.stagedDirectory,'manifest.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const st=await f.stat();if(!st.isFile()||st.uid!==process.geteuid()||st.nlink!==1||(st.mode&0o7777)!==0o600||st.size<1||st.size>2*1024*1024)fail();
  const b=await f.readFile();if(b.length!==st.size||sha(b)!==p.trustedManifestSha256||!same(st,await f.stat())||!same(st,await lstat(join(p.stagedDirectory,'manifest.json'))))fail();
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(b);rejectDuplicateJsonKeys(raw);
  const entries=JSON.parse(raw).files.filter(e=>e.path.startsWith('runtime/')).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(entries.length<5||entries.length>400||new Set(entries.map(e=>e.path)).size!==entries.length)fail();
  let bytes=1024;for(const e of entries){if(!/^runtime\/(?:index\.json|oci-layout|blobs\/sha256\/[a-f0-9]{64})$/.test(e.path)||!hex(e.sha256)||!Number.isSafeInteger(e.size)||e.size<1||e.size>0o77777777777)fail();bytes+=512+Math.ceil(e.size/512)*512}
  if(bytes!==p.archiveBytes)fail();return entries;
 }finally{await f.close()}
}
function header(name,size){
 const h=canonicalDockerArchiveHeader('member',size);
 h.fill(0,0,100);h.write(name,0,'ascii');h.fill(32,148,156);h.write(h.reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148,'ascii');return h;
}
export async function verifyNativeOciArchive(input){
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||!exact(input,keys))fail();
 const p={...input};
 if(p.confirmation!=='VERIFY_NATIVE_OCI_ARCHIVE_ONLY'||!pathOk(p.archivePath)||basename(p.archivePath)!=='runtime-oci.tar'||!pathOk(p.stagedDirectory)||within(p.stagedDirectory,p.archivePath)||within(dirname(p.archivePath),p.stagedDirectory)||![p.archiveSha256,p.trustedManifestSha256,p.trustedSignerSpkiSha256].every(hex)||!Number.isSafeInteger(p.archiveBytes)||p.archiveBytes<1024||p.archiveBytes>33*1024**3||p.archiveBytes%512||!['amd64','arm64'].includes(p.architecture)||typeof p.trustedPublicKeyPem!=='string'||p.trustedPublicKeyPem.length>8192)fail();
 const before=await custody(p.archivePath,p.archiveBytes);
 const pins={confirmation:'INSPECT_SIGNED_OCI_RUNTIME_ONLY',stagedDirectory:p.stagedDirectory,trustedManifestSha256:p.trustedManifestSha256,trustedPublicKeyPem:p.trustedPublicKeyPem,trustedSignerSpkiSha256:p.trustedSignerSpkiSha256,architecture:p.architecture};
 const release=await inspectOfflineOciRuntime(pins);
 if(!release.release_signature_verified||!release.strict_ustar_profile_verified||!release.cross_layer_path_profile_verified)fail();
 const entries=await manifestEntries(p);
 const f=await open(p.archivePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(before.file,await f.stat()))fail();
  let at=0;const whole=createHash('sha256'),deadline=Date.now()+300000;
  const read=async n=>{if(n<0||n>1048576||at+n>p.archiveBytes||Date.now()>deadline)fail();const b=Buffer.alloc(n);let used=0;while(used<n){const r=await f.read(b,used,n-used,at+used);if(!r.bytesRead||Date.now()>deadline)fail();used+=r.bytesRead}at+=n;whole.update(b);return b};
  for(const e of entries){
   if(!(await read(512)).equals(header(e.path.slice(8),e.size)))fail();
   let remaining=e.size;const hash=createHash('sha256');while(remaining){const n=Math.min(remaining,1048576);hash.update(await read(n));remaining-=n}
   if(hash.digest('hex')!==e.sha256||(await read((512-e.size%512)%512)).some(x=>x!==0))fail();
  }
  if((await read(1024)).some(x=>x!==0)||at!==p.archiveBytes||whole.digest('hex')!==p.archiveSha256||(await f.read(Buffer.alloc(1),0,1,at)).bytesRead!==0)fail();
  const final=await inspectOfflineOciRuntime(pins);
  if(JSON.stringify(final)!==JSON.stringify(release)||!same(before.file,await f.stat())||!sameCustody(before,await custody(p.archivePath,p.archiveBytes)))fail();
 }finally{await f.close()}
 return Object.freeze({schema_version:1,archive_sha256:p.archiveSha256,archive_bytes:p.archiveBytes,approved_manifest_sha256:release.approved_manifest_sha256,expected_manifest_ids:Object.fromEntries(release.images.map(x=>[x.role,x.manifest_digest])),expected_config_ids:Object.fromEntries(release.images.map(x=>[x.role,x.image_config_id])),images:release.images.map(x=>({role:x.role,manifest_id:x.manifest_digest,config_id:x.image_config_id,diff_ids:x.layers.map(l=>l.diff_id)})),archive_bytes_verified:true,release_signature_verified:true,ordered_layer_diff_ids_verified:true,image_imported:false,installation_authorized:false,production_accepted:false});
}
