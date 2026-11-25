// Independent read-only admission of a previously prepared canonical Docker
// archive. Never calls Docker, extracts files, starts containers or authorizes
// installation. Requires independently pinned staged release and archive receipt.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {dirname,basename,isAbsolute,resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectOfflineOciRuntime} from './inspect-offline-oci-runtime.mjs';
import {canonicalDockerArchiveHeader,planDockerArchive} from './prepare-offline-docker-archive.mjs';
const fail=()=>{throw Error('OFFLINE_DOCKER_ARCHIVE_ADMISSION_UNVERIFIED')};
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const absolute=x=>typeof x==='string'&&x.length>0&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const within=(a,b)=>{const p=relative(a,b);return !p||(!isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+sep))};
const fields=['dev','ino','uid','mode','size','nlink','mtimeMs','ctimeMs'];
const same=(a,b,keys=fields)=>keys.every(k=>a[k]===b[k]);
const dirFields=['dev','ino','uid','mode','mtimeMs','ctimeMs'];
const keys=['confirmation','archivePath','archiveSha256','archiveBytes','stagedDirectory','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256','architecture'];
const sha=b=>createHash('sha256').update(b).digest('hex');
export function validateArchiveAdmissionPolicy(input){
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input))||
    Reflect.ownKeys(input).length!==keys.length||!keys.every(k=>{const d=Object.getOwnPropertyDescriptor(input,k);return d?.enumerable&&Object.hasOwn(d,'value')}))fail();
 const p=Object.fromEntries(keys.map(k=>[k,input[k]]));
 if(p.confirmation!=='VERIFY_PREPARED_DOCKER_ARCHIVE_ONLY'||!absolute(p.archivePath)||basename(p.archivePath)!=='runtime.tar'||
    !absolute(p.stagedDirectory)||within(p.stagedDirectory,p.archivePath)||within(dirname(p.archivePath),p.stagedDirectory)||
    !hex(p.archiveSha256)||!hex(p.trustedManifestSha256)||!hex(p.trustedSignerSpkiSha256)||
    !Number.isSafeInteger(p.archiveBytes)||p.archiveBytes<1024||p.archiveBytes>33*1024**3||p.archiveBytes%512!==0||
    !['amd64','arm64'].includes(p.architecture)||typeof p.trustedPublicKeyPem!=='string'||
    p.trustedPublicKeyPem.length>8192||!p.trustedPublicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n'))fail();
 return Object.freeze(p);
}
async function directory(path){
 const st=await lstat(path);
 if(!st.isDirectory()||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o700||await realpath(path)!==path)fail();
 return st;
}
async function custody(path,size){
 const parent=dirname(path),root=dirname(parent);
 const rootStat=await directory(root),parentStat=await directory(parent),file=await lstat(path);
 if(!file.isFile()||file.uid!==process.geteuid()||(file.mode&0o7777)!==0o600||file.nlink!==1||
    file.size!==size||await realpath(path)!==path)fail();
 return {root:rootStat,parent:parentStat,file};
}
const sameCustody=(a,b)=>same(a.root,b.root,dirFields)&&same(a.parent,b.parent,dirFields)&&same(a.file,b.file);
// Exact canonical outer tar bytes, expected ordered members, payload hashes,
// zero padding and exactly two end blocks. No generic tar extraction/parser.
export async function verifyCanonicalArchiveStream(fd,plan,expectedSha){
 if(!hex(expectedSha)||!Number.isSafeInteger(plan?.archiveBytes)||plan.archiveBytes<1024||plan.archiveBytes>33*1024**3)fail();
 const whole=createHash('sha256');let offset=0;const deadline=Date.now()+300000;
 const read=async n=>{
  if(!Number.isSafeInteger(n)||n<0||n>1024*1024||offset+n>plan.archiveBytes||Date.now()>deadline)fail();
  const b=Buffer.alloc(n);let used=0;
  while(used<n){const r=await fd.read(b,used,n-used,offset+used);if(!r.bytesRead||Date.now()>deadline)fail();used+=r.bytesRead}
  offset+=n;whole.update(b);return b;
 };
 const member=async(name,size,digest)=>{
  if(!hex(digest)||!Number.isSafeInteger(size)||size<1)fail();
  if(!(await read(512)).equals(canonicalDockerArchiveHeader(name,size)))fail();
  const hash=createHash('sha256');let remaining=size;
  while(remaining){const n=Math.min(remaining,1024*1024);hash.update(await read(n));remaining-=n}
  if(hash.digest('hex')!==digest)fail();
  if((await read((512-size%512)%512)).some(x=>x!==0))fail();
 };
 for(const [name,c] of plan.configs)await member(name,c.size,c.digest);
 for(const [name,l] of plan.layers)await member(name,l.uncompressed_bytes,l.diff_id.slice(7));
 await member('manifest.json',plan.manifestBytes.length,sha(plan.manifestBytes));
 if((await read(1024)).some(x=>x!==0)||offset!==plan.archiveBytes||whole.digest('hex')!==expectedSha)fail();
 // Catch extra bytes independently of the declared length.
 if((await fd.read(Buffer.alloc(1),0,1,offset)).bytesRead!==0)fail();
 return true;
}
export async function verifyPreparedDockerArchive(input){
 const p=validateArchiveAdmissionPolicy(input);
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||!constants.O_NOFOLLOW)fail();
 try{
  const before=await custody(p.archivePath,p.archiveBytes);
  const pins={confirmation:'INSPECT_SIGNED_OCI_RUNTIME_ONLY',stagedDirectory:p.stagedDirectory,
   trustedManifestSha256:p.trustedManifestSha256,trustedPublicKeyPem:p.trustedPublicKeyPem,
   trustedSignerSpkiSha256:p.trustedSignerSpkiSha256,architecture:p.architecture};
  const release=await inspectOfflineOciRuntime(pins);
  if(release.strict_ustar_profile_verified!==true||release.cross_layer_path_profile_verified!==true)fail();
  const plan=planDockerArchive(release);
  if(plan.archiveBytes!==p.archiveBytes||!sameCustody(before,await custody(p.archivePath,p.archiveBytes)))fail();
  const fd=await open(p.archivePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   if(!same(before.file,await fd.stat()))fail();
   await verifyCanonicalArchiveStream(fd,plan,p.archiveSha256);
   const final=await inspectOfflineOciRuntime(pins);
   if(JSON.stringify(final)!==JSON.stringify(release)||!same(before.file,await fd.stat())||
      !sameCustody(before,await custody(p.archivePath,p.archiveBytes)))fail();
  }finally{await fd.close()}
  return Object.freeze({schema_version:1,archive_sha256:p.archiveSha256,archive_bytes:p.archiveBytes,
   approved_manifest_sha256:release.approved_manifest_sha256,
   expected_image_ids:Object.freeze(Object.fromEntries(release.images.map(x=>[x.role,x.image_config_id]))),
   archive_bytes_verified:true,ordered_layer_diff_ids_verified:true,release_signature_verified:true,
   cross_layer_path_profile_verified:true,image_imported:false,runtime_compatibility_verified:false,
   installation_authorized:false,production_accepted:false});
 }catch{fail()}
}
