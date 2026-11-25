// POSIX operator-controlled offline staging, NOT runtime provisioning.
// Source and private destination ancestors must be trusted local storage.
// No archive extraction, image import, network fetch or execution.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdtemp,mkdir,chmod,rm,statfs} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {verifySignedLanBundle} from './verify-lan-bundle.mjs';
const fail=code=>{throw Error(code)};
const maxBytes=64n*1024n*1024n*1024n;
const abs=x=>typeof x==='string'&&isAbsolute(x)&&!x.includes('\0');
const digest=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x);
const same=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const within=(base,path)=>{const r=relative(base,path);return !r||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep))};
async function assertDirectory(path,old){
 const s=await lstat(path);
 if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o777)!==0o700||
    await realpath(path)!==path||(old&&(s.dev!==old.dev||s.ino!==old.ino)))fail('PRIVATE_STAGING_DIRECTORY_REQUIRED');
 return s;
}
async function syncDirectory(path){
 const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await fd.sync()}finally{await fd.close()}
}
async function copyExact(source,dest,size,expected){
 const before=await lstat(source);
 if(!before.isFile()||before.nlink!==1||before.size!==size)fail('STAGING_SOURCE_CHANGED');
 const src=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(before,await src.stat()))fail('STAGING_SOURCE_CHANGED');
  const out=await open(dest,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
   await out.chmod(0o600);
   const buffer=Buffer.alloc(1024*1024),hash=createHash('sha256');let count=0;
   while(count<size){
    const {bytesRead}=await src.read(buffer,0,Math.min(buffer.length,size-count),count);
    if(!bytesRead)fail('STAGING_SOURCE_CHANGED');
    hash.update(buffer.subarray(0,bytesRead));
    let written=0;while(written<bytesRead){
     const r=await out.write(buffer,written,bytesRead-written,count+written);
     if(r.bytesWritten<=0)fail('STAGING_WRITE_UNCONFIRMED');written+=r.bytesWritten;
    }
    count+=bytesRead;
   }
   if((await src.read(buffer,0,1,count)).bytesRead!==0||
    !same(before,await src.stat())||!same(before,await lstat(source))||
    hash.digest('hex')!==expected)fail('STAGING_SOURCE_CHANGED');
   await out.sync();
  }finally{await out.close()}
 }finally{await src.close()}
}
async function readSmall(path,max){
 const s=await lstat(path);
 if(!s.isFile()||s.nlink!==1||s.size<1||s.size>max)fail('STAGING_METADATA_INVALID');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(s,await fd.stat()))fail('STAGING_METADATA_INVALID');
  const b=Buffer.alloc(s.size+1);let n=0;
  while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==s.size||!same(s,await fd.stat())||!same(s,await lstat(path)))fail('STAGING_METADATA_INVALID');
  return b.subarray(0,n);
 }finally{await fd.close()}
}
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function stageOfflineLanBundle({confirmation,bundle,destinationParent}={}){
 if(confirmation!=='STAGE_VERIFIED_OFFLINE_BUNDLE_ONLY'||process.platform!=='linux'||
    typeof process.geteuid!=='function'||!constants.O_NOFOLLOW||!bundle||
    ![bundle.root,bundle.manifest,bundle.signature,destinationParent].every(abs)||
    !digest(bundle.trustedManifestSha256)||!digest(bundle.trustedSignerSpkiSha256))fail('EXPLICIT_OFFLINE_STAGING_REQUIRED');
 const input={...bundle},parent=resolve(destinationParent),root=resolve(input.root);
 const parentStat=await assertDirectory(parent);
 if(await realpath(root)!==root||within(root,parent)||within(parent,root)||
    within(parent,resolve(input.manifest))||within(parent,resolve(input.signature)))fail('STAGING_SOURCE_DESTINATION_OVERLAP');
 const verified=await verifySignedLanBundle(input);
 if(!verified.publisher_signature_verified||!verified.payload_integrity_verified)fail('STAGING_RELEASE_UNVERIFIED');
 const manifest=await readSmall(input.manifest,2*1024*1024),signature=await readSmall(input.signature,64);
 if(sha(manifest)!==input.trustedManifestSha256||signature.length!==64)fail('STAGING_METADATA_INVALID');
 const doc=JSON.parse(manifest.toString('utf8'));
 const total=doc.files.reduce((n,f)=>n+BigInt(f.size),BigInt(manifest.length+signature.length));
 const fs=await statfs(parent,{bigint:true});
 if(total>maxBytes||fs.bavail<0n||fs.bsize<=0n||fs.bavail*fs.bsize<total+1048576n)fail('STAGING_CAPACITY_UNVERIFIED');
 await assertDirectory(parent,parentStat);
 let stage;
 try{
  stage=await mkdtemp(join(parent,'release-'));
  await chmod(stage,0o700);
  const payload=join(stage,'payload');await mkdir(payload,{mode:0o700});
  const directories=new Set([payload,stage]);
  for(const f of doc.files){
   const dest=join(payload,...f.path.split('/'));
   if(!within(payload,dest)||dest===payload)fail('STAGING_PATH_INVALID');
   const dir=dirname(dest);await mkdir(dir,{recursive:true,mode:0o700});
   for(let d=dir;d!==stage;d=dirname(d))directories.add(d);
   await copyExact(join(root,...f.path.split('/')),dest,f.size,f.sha256.toLowerCase());
  }
  const manifestPath=join(stage,'manifest.json'),signaturePath=join(stage,'manifest.sig');
  await copyExact(input.manifest,manifestPath,manifest.length,sha(manifest));
  await copyExact(input.signature,signaturePath,signature.length,sha(signature));
  const staged=await verifySignedLanBundle({...input,root:payload,manifest:manifestPath,signature:signaturePath});
  if(staged.files!==verified.files||staged.approved_manifest_sha256!==verified.approved_manifest_sha256)fail('STAGING_RELEASE_UNVERIFIED');
  for(const d of [...directories].sort((a,b)=>b.length-a.length))await syncDirectory(d);
  await assertDirectory(parent,parentStat);await syncDirectory(parent);
  return Object.freeze({schema_version:1,staged_directory:stage,files:staged.files,approved_manifest_sha256:staged.approved_manifest_sha256,
   staged_signature_verified:true,staged_payload_integrity_verified:true,runtime_imported:false,
   installation_authorized:false,offline_execution_verified:false,production_accepted:false});
 }catch(e){
  // Only remove the unique directory created by this operation, under trusted
  // exclusive operator custody. Crash leftovers require manual reconciliation.
  if(stage){await assertDirectory(parent,parentStat);await rm(stage,{recursive:true,force:true});await syncDirectory(parent)}
  throw e;
 }
}
