// Local operator-only inspection of supplied direct-root TLS material.
// No CA/key generation, trust-store mutation, server listener or provisioning.
import {constants} from 'node:fs';
import {lstat,realpath,open} from 'node:fs/promises';
import {dirname,resolve,isAbsolute} from 'node:path';
import {createHash,createPrivateKey,X509Certificate} from 'node:crypto';
import {createSecureContext} from 'node:tls';
import {isIP} from 'node:net';
import {validatePrivateTlsInputs} from './private-lan-tls-preflight.mjs';
const fail=code=>{throw Error(code)};
const sha=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>['dev','ino','uid','mode','nlink','size','ctimeMs','mtimeMs'].every(k=>a[k]===b[k]);
const privateFile=(s,uid)=>s.isFile()&&s.nlink===1&&s.uid===uid&&(s.mode&0o7777)===0o600;
const validPath=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&!x.includes('\0')&&resolve(x)===x;
async function directory(path,uid){
 const d=dirname(path),s=await lstat(d);
 if(!s.isDirectory()||s.uid!==uid||(s.mode&0o7777)!==0o700||await realpath(d)!==d)fail('TLS_PRIVATE_MATERIAL_REQUIRED');
 return {path:d,stat:s};
}
async function readPrivate(path,uid){
 const parent=await directory(path,uid),s=await lstat(path);
 if(!privateFile(s,uid)||s.size<1||s.size>16384||await realpath(path)!==path)fail('TLS_PRIVATE_MATERIAL_REQUIRED');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const b=Buffer.alloc(s.size+1);let n=0;
 try{
  if(!same(s,await fd.stat()))fail('TLS_MATERIAL_CHANGED');
  while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==s.size||!same(s,await fd.stat())||!same(s,await lstat(path)))fail('TLS_MATERIAL_CHANGED');
  return {bytes:b.subarray(0,n),stat:s,parent};
 }catch(e){b.fill(0);throw e}finally{await fd.close()}
}
async function assertUnchanged(path,record,uid){
 const parent=await directory(path,uid);
 if(!same(record.stat,await lstat(path))||
    !['dev','ino','uid','mode'].every(k=>record.parent.stat[k]===parent.stat[k]))fail('TLS_MATERIAL_CHANGED');
}
const singleCert=/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/;
const singleKey=/^-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=\r\n]+-----END \1-----\r?\n?$/;
export async function inspectPrivateLanTlsMaterial(options={}){
 const {confirmation,address,hostname,port,rootPem,trustedRootSha256,leafCertificatePath,privateKeyPath}=options;
 if(confirmation!=='INSPECT_PRIVATE_TLS_MATERIAL_ONLY'||process.platform!=='linux'||
   typeof process.geteuid!=='function'||!constants.O_NOFOLLOW||!validPath(leafCertificatePath)||
   !validPath(privateKeyPath)||leafCertificatePath===privateKeyPath)fail('EXPLICIT_TLS_MATERIAL_INSPECTION_REQUIRED');
 const target=validatePrivateTlsInputs({address,hostname,port,rootPem,trustedRootSha256}),uid=process.geteuid();
 let leafRecord,keyRecord;
 try{
  leafRecord=await readPrivate(leafCertificatePath,uid);keyRecord=await readPrivate(privateKeyPath,uid);
  // Single PEM objects only; encrypted keys and embedded chains unsupported.
  if(!singleCert.test(leafRecord.bytes.toString('latin1'))||!singleKey.test(keyRecord.bytes.toString('latin1')))
   fail('TLS_MATERIAL_FORMAT_INVALID');
  const leaf=new X509Certificate(leafRecord.bytes),root=new X509Certificate(rootPem);
  const key=createPrivateKey(keyRecord.bytes);
  const now=Date.now(),match=isIP(target.hostname)?leaf.checkIP(target.hostname):
   leaf.checkHost(target.hostname,{subject:'never',wildcards:false});
  if(leaf.ca||!match||!leaf.checkIssued(root)||!leaf.verify(root.publicKey)||
     !(Date.parse(leaf.validFrom)<=now&&now<=Date.parse(leaf.validTo))||
     Date.parse(leaf.validTo)>Date.parse(root.validTo)||
     !leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1'))fail('TLS_LEAF_POLICY_INVALID');
  if(!leaf.checkPrivateKey(key))fail('TLS_KEY_MISMATCH');
  // Check the local runtime accepts this key/certificate combination, without listening.
  createSecureContext({cert:leafRecord.bytes,key:keyRecord.bytes,ca:rootPem,minVersion:'TLSv1.2'});
  await assertUnchanged(leafCertificatePath,leafRecord,uid);
  await assertUnchanged(privateKeyPath,keyRecord,uid);
  return Object.freeze({schema_version:1,root_sha256:target.fingerprint,leaf_sha256:sha(leaf.raw),
   direct_root_signature_verified:true,exact_san_verified:true,server_auth_eku_verified:true,
   key_match_verified:true,local_tls_context_created:true,private_custody_observed:true,
   endpoint_handshake_verified:false,system_trust_verified:false,revocation_verified:false,
   installation_authorized:false,production_accepted:false});
 }catch(e){
  // OpenSSL and filesystem exceptions can include material/path details.
  if(['TLS_MATERIAL_FORMAT_INVALID','TLS_LEAF_POLICY_INVALID','TLS_KEY_MISMATCH','TLS_PRIVATE_MATERIAL_REQUIRED','TLS_MATERIAL_CHANGED'].includes(e?.message))throw e;
  fail('TLS_MATERIAL_INSPECTION_REFUSED');
 }finally{if(keyRecord)keyRecord.bytes.fill(0)}
}
