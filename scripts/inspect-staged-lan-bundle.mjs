// Local re-verification of a staged release under exclusive trusted custody.
// Never trust an earlier receipt as current byte or runtime authorization.
import {lstat,realpath,opendir} from 'node:fs/promises';
import {resolve,dirname,basename,join,isAbsolute} from 'node:path';
import {verifySignedLanBundle} from './verify-lan-bundle.mjs';
const fail=()=>{throw Error('STAGED_RELEASE_CUSTODY_UNVERIFIED')};
const fields=['dev','ino','size','mtimeMs','ctimeMs','uid','mode','nlink'];
const fingerprint=s=>fields.map(k=>s[k]);
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const privateNode=(s,dir,uid)=>s.uid===uid&&(s.mode&0o7777)===(dir?0o700:0o600)&&
 (dir?s.isDirectory():s.isFile()&&s.nlink===1);
async function snapshot(stage,uid){
 const found=new Map(),stack=[{path:stage,depth:0}];let scanned=0;
 while(stack.length){
  const {path,depth}=stack.pop();
  if(depth>66||found.size>=20200)fail();
  const before=await lstat(path);
  if(!privateNode(before,true,uid)||await realpath(path)!==path)fail();
  found.set(path,fingerprint(before));
  const names=new Set();
  for await(const entry of await opendir(path)){
   if(++scanned>20200)fail();
   if(names.has(entry.name)||entry.isSymbolicLink())fail();
   names.add(entry.name);
   const child=join(path,entry.name),s=await lstat(child);
   if(entry.isDirectory()&&privateNode(s,true,uid)){stack.push({path:child,depth:depth+1});continue}
   if(!entry.isFile()||!privateNode(s,false,uid))fail();
   found.set(child,fingerprint(s));
  }
  if(depth===0&&(!equal([...names].sort(),['manifest.json','manifest.sig','payload'])||
    !privateNode(await lstat(join(stage,'payload')),true,uid)||
    !privateNode(await lstat(join(stage,'manifest.json')),false,uid)||
    !privateNode(await lstat(join(stage,'manifest.sig')),false,uid)))fail();
  if(!equal(fingerprint(before),fingerprint(await lstat(path))))fail();
 }
 return found;
}
export async function inspectStagedLanBundle({confirmation,stagedDirectory,trustedManifestSha256,
 trustedPublicKeyPem,trustedSignerSpkiSha256}={}){
 if(confirmation!=='INSPECT_STAGED_RELEASE_ONLY'||process.platform!=='linux'||
    typeof process.geteuid!=='function'||typeof stagedDirectory!=='string'||stagedDirectory.length>4096||
    !isAbsolute(stagedDirectory)||stagedDirectory.includes('\0')||resolve(stagedDirectory)!==stagedDirectory||
    !/^release-[A-Za-z0-9]{6}$/.test(basename(stagedDirectory))||
    !hex(trustedManifestSha256)||!hex(trustedSignerSpkiSha256))fail();
 const stage=stagedDirectory,parent=dirname(stage),uid=process.geteuid();
 const parentBefore=await lstat(parent);
 if(!privateNode(parentBefore,true,uid)||await realpath(parent)!==parent)fail();
 const before=await snapshot(stage,uid);
 const result=await verifySignedLanBundle({root:join(stage,'payload'),manifest:join(stage,'manifest.json'),
  signature:join(stage,'manifest.sig'),trustedManifestSha256,trustedPublicKeyPem,trustedSignerSpkiSha256});
 const after=await snapshot(stage,uid);
 if(!privateNode(await lstat(parent),true,uid)||await realpath(parent)!==parent||
    !equal(fingerprint(parentBefore),fingerprint(await lstat(parent)))||before.size!==after.size||
    [...before].some(([path,value])=>!after.has(path)||!equal(value,after.get(path))))fail();
 return Object.freeze({schema_version:1,approved_manifest_sha256:result.approved_manifest_sha256,
  signer_spki_sha256:result.signer_spki_sha256,files:result.files,
  staged_signature_verified:true,staged_payload_integrity_verified:true,private_custody_observed:true,
  runtime_imported:false,installation_authorized:false,offline_execution_verified:false,production_accepted:false});
}
