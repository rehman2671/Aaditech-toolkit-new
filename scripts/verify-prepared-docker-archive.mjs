// Read-only, independently pinned Docker archive readback. No daemon or extraction.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,isAbsolute,dirname,basename,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectOfflineOciRuntime} from './inspect-offline-oci-runtime.mjs';
import {planDockerArchive,dockerArchiveMemberHeader} from './prepare-offline-docker-archive.mjs';
const fail=()=>{throw Error('OFFLINE_DOCKER_ARCHIVE_READBACK_UNVERIFIED')};
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const canonical=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const fields=['dev','ino','uid','mode','size','nlink','mtimeMs','ctimeMs'];
const dirFields=['dev','ino','uid','mode'];
const same=(a,b,keys=fields)=>keys.every(k=>a[k]===b[k]);
const ownData=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);return !!d&&d.enumerable&&Object.hasOwn(d,'value')};
const keys=['confirmation','archivePath','expectedArchiveSha256','stagedDirectory','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256','architecture'];
const within=(a,b)=>{const p=relative(a,b);return !p||(!isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+sep))};
export function validateArchiveReadbackInput(input){
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input))||
    Reflect.ownKeys(input).length!==keys.length||!keys.every(k=>ownData(input,k)))fail();
 const p={...input};
 if(p.confirmation!=='VERIFY_PREPARED_DOCKER_ARCHIVE_ONLY'||!canonical(p.archivePath)||
    basename(p.archivePath)!=='runtime.tar'||!canonical(p.stagedDirectory)||
    within(p.stagedDirectory,p.archivePath)||within(dirname(p.archivePath),p.stagedDirectory)||
    ![p.expectedArchiveSha256,p.trustedManifestSha256,p.trustedSignerSpkiSha256].every(hex)||
    !['amd64','arm64'].includes(p.architecture)||typeof p.trustedPublicKeyPem!=='string'||
    p.trustedPublicKeyPem.length>8192||!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?(?![\s\S])/.test(p.trustedPublicKeyPem))fail();
 return Object.freeze(p);
}
async function privateDir(path){
 const s=await lstat(path);
 if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(path)!==path)fail();
 return s;
}
export async function verifyPreparedDockerArchive(input){
 const p=validateArchiveReadbackInput(input);
 if(process.platform!=='linux'||typeof process.geteuid!=='function'||!constants.O_NOFOLLOW)fail();
 const dir=dirname(p.archivePath),beforeDir=await privateDir(dir);
 const pins={confirmation:'INSPECT_SIGNED_OCI_RUNTIME_ONLY',stagedDirectory:p.stagedDirectory,
  trustedManifestSha256:p.trustedManifestSha256,trustedPublicKeyPem:p.trustedPublicKeyPem,
  trustedSignerSpkiSha256:p.trustedSignerSpkiSha256,architecture:p.architecture};
 const release=await inspectOfflineOciRuntime(pins),plan=planDockerArchive(release);
 const st=await lstat(p.archivePath);
 if(!st.isFile()||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o600||st.nlink!==1||
    st.size!==plan.archiveBytes||await realpath(p.archivePath)!==p.archivePath||
    !same(beforeDir,await privateDir(dir),dirFields))fail();
 const fd=await open(p.archivePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(st,await fd.stat()))fail();
  let offset=0;const hash=createHash('sha256'),scratch=Buffer.alloc(1024*1024);
  async function read(n){
   if(n<0||n>scratch.length||offset+n>st.size)fail();
   let got=0;while(got<n){const r=await fd.read(scratch,got,n-got,offset+got);if(!r.bytesRead)fail();got+=r.bytesRead}
   offset+=n;const b=scratch.subarray(0,n);hash.update(b);return b;
  }
  async function exact(b){if(!(await read(b.length)).equals(b))fail()}
  async function padding(n){if((await read((512-n%512)%512)).some(x=>x!==0))fail()}
  async function member(name,size,digest){
   await exact(dockerArchiveMemberHeader(name,size));
   const h=createHash('sha256');let remaining=size;
   while(remaining){const n=Math.min(remaining,scratch.length);h.update(await read(n));remaining-=n}
   if(h.digest('hex')!==digest)fail();
   await padding(size);
  }
  for(const [name,c] of plan.configs)await member(name,c.size,c.digest);
  for(const [name,l] of plan.layers)await member(name,l.uncompressed_bytes,l.diff_id.slice(7));
  await exact(dockerArchiveMemberHeader('manifest.json',plan.manifestBytes.length));
  await exact(plan.manifestBytes);await padding(plan.manifestBytes.length);await exact(Buffer.alloc(1024));
  if(offset!==st.size||hash.digest('hex')!==p.expectedArchiveSha256)fail();
  const final=await inspectOfflineOciRuntime(pins);
  if(JSON.stringify(final)!==JSON.stringify(release)||!same(st,await fd.stat())||
    !same(st,await lstat(p.archivePath))||!same(beforeDir,await privateDir(dir),dirFields))fail();
  return Object.freeze({schema_version:1,archive_sha256:p.expectedArchiveSha256,archive_bytes:offset,
   approved_manifest_sha256:release.approved_manifest_sha256,
   archive_readback_verified:true,signed_source_binding_verified:true,cross_layer_path_profile_verified:true,
   expected_image_ids:Object.freeze(Object.fromEntries(release.images.map(x=>[x.role,x.image_config_id]))),
   image_imported:false,merged_rootfs_verified:false,installation_authorized:false,production_accepted:false});
 }finally{await fd.close()}
}
