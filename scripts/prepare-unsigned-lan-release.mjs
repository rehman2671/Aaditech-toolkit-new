// Publisher-side unsigned candidate preparation. No signing key, automatic
// approval, image import, registry access or production authorization.
import {constants} from 'node:fs';
import {lstat,realpath,readdir,open,mkdir,mkdtemp,statfs} from 'node:fs/promises';
import {join,resolve,isAbsolute,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyLanBundle,rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {verifyOfflineOciGraph} from './inspect-offline-oci-runtime.mjs';
import {selectSignedMigrationEntries} from './initialize-fresh-mysql-schema.mjs';
import {planMigrationHistory} from '../schema-migration-integrity.js';
const fail=()=>{throw Error('UNSIGNED_LAN_RELEASE_UNCONFIRMED')};
const max=64*1024**3,small=1048576;
const fields=['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'],same=(a,b,ks=fields)=>ks.every(k=>a[k]===b[k]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const exact=(x,ks)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const pathOk=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const within=(a,b)=>{const r=relative(a,b);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('../'))};
export function validateUnsignedReleasePolicy(input){
 if(!exact(input,['confirmation','runtimeRoot','migrationsDirectory','destinationParent','architecture'])||input.confirmation!=='PREPARE_UNSIGNED_LAN_RELEASE_CANDIDATE_ONLY'||!['amd64','arm64'].includes(input.architecture))fail();
 const paths=[input.runtimeRoot,input.migrationsDirectory,input.destinationParent];
 if(!paths.every(pathOk)||paths.some((a,i)=>paths.some((b,j)=>i!==j&&within(a,b))))fail();
 return Object.freeze({...input});
}
async function directory(path,privateOnly=false,prior=null){
 const s=await lstat(path);if(!s.isDirectory()||await realpath(path)!==path||s.uid!==process.geteuid()||(privateOnly?(s.mode&0o7777)!==0o700:(s.mode&0o022)!==0)||prior&&!same(s,prior,['dev','ino','uid','mode']))fail();return s;
}
async function scan(p){
 const root=await directory(p.runtimeRoot),names=await readdir(p.runtimeRoot);
 if(names.length!==3||!['oci-layout','index.json','blobs'].every(x=>names.includes(x)))fail();
 const blobs=join(p.runtimeRoot,'blobs'),base=await directory(blobs);
 if(JSON.stringify(await readdir(blobs))!==JSON.stringify(['sha256']))fail();
 const content=join(blobs,'sha256'),contentStat=await directory(content),blobNames=(await readdir(content)).sort();
 if(blobNames.length<1||blobNames.length>9900||blobNames.some(x=>x.length!==64||!/^[a-f0-9]{64}$/.test(x)))fail();
 const mig=await directory(p.migrationsDirectory),migrationNames=(await readdir(p.migrationsDirectory)).sort();
 if(migrationNames.some(x=>x!=='README.md'&&!/^\d{3}_[a-z0-9_]+\.sql$/.test(x)))fail();
 const sql=migrationNames.filter(x=>x.endsWith('.sql'));
 if(sql.length!==24||sql.some((x,i)=>!x.startsWith(String(i+1).padStart(3,'0')+'_')))fail();
 const items=[...['oci-layout','index.json'].map(x=>({source:join(p.runtimeRoot,x),path:'runtime/'+x,max:small})),...blobNames.map(x=>({source:join(content,x),path:'runtime/blobs/sha256/'+x,max})),...sql.map(x=>({source:join(p.migrationsDirectory,x),path:'database/migrations/'+x,max:small}))];
 let total=0;
 for(const item of items){
  const s=await lstat(item.source);
  if(!s.isFile()||s.nlink!==1||s.uid!==process.geteuid()||(s.mode&0o022)!==0||s.size<1||s.size>item.max||await realpath(item.source)!==item.source)fail();
  item.stat=s;total+=s.size;if(total>max)fail();
 }
 await directory(p.runtimeRoot,false,root);await directory(blobs,false,base);await directory(content,false,contentStat);await directory(p.migrationsDirectory,false,mig);
 return {items,total};
}
async function syncDir(path){const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await fd.sync()}finally{await fd.close()}}
async function copy(item,dest){
 const src=await open(item.source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(item.stat,await src.stat()))fail();
  const out=await open(dest,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const hash=createHash('sha256');
  try{
   await out.chmod(0o600);const b=Buffer.alloc(1024*1024);let n=0;
   while(n<item.stat.size){const {bytesRead:k}=await src.read(b,0,Math.min(b.length,item.stat.size-n),n);if(k<1)fail();hash.update(b.subarray(0,k));let offset=0;while(offset<k){const {bytesWritten:w}=await out.write(b,offset,k-offset,n+offset);if(w<1)fail();offset+=w}n+=k}
   if((await src.read(b,0,1,n)).bytesRead!==0||!same(item.stat,await src.stat())||!same(item.stat,await lstat(item.source)))fail();
   await out.sync();const digest=hash.digest('hex');if(item.path.startsWith('runtime/blobs/sha256/')&&digest!==item.path.split('/').pop())fail();
   return {path:item.path,size:n,sha256:digest};
  }finally{await out.close()}
 }finally{await src.close()}
}
async function readVerified(path,entry){
 if(entry.size>small)fail();const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const s=await fd.stat();if(!s.isFile()||s.nlink!==1||s.size!==entry.size||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o600)fail();
  const b=Buffer.alloc(s.size+1);let n=0;while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  const bytes=b.subarray(0,n);if(n!==entry.size||sha(bytes)!==entry.sha256||!same(s,await fd.stat())||!same(s,await lstat(path))||bytes.includes(0)||(bytes[0]===239&&bytes[1]===187&&bytes[2]===191))fail();
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }finally{await fd.close()}
}
export async function prepareUnsignedLanRelease(input){
 if(process.platform!=='linux'||typeof process.geteuid!=='function')fail();
 const p=validateUnsignedReleasePolicy(input),parent=await directory(p.destinationParent,true),source=await scan(p);
 const fs=await statfs(p.destinationParent,{bigint:true});if(fs.bavail*fs.bsize<BigInt(source.total)+1048576n)fail();
 const candidate=await mkdtemp(join(p.destinationParent,'unsigned-'));const root=join(candidate,'payload');
 // A failed candidate is retained, never mistaken for an approved release.
 // No manifest is emitted until all input and graph checks pass.
 await directory(candidate,true);await mkdir(root,{mode:0o700});
 const entries=[],dirs=new Set([candidate,root]);
 for(const item of source.items){
  const dest=join(root,item.path),dir=dirname(dest);await mkdir(dir,{recursive:true,mode:0o700});
  for(let d=dir;d!==root;d=dirname(d))dirs.add(d);
  entries.push(await copy(item,dest));
 }
 const after=await scan(p);
 if(after.items.length!==source.items.length||after.items.some((x,i)=>x.path!==source.items[i].path||!same(x.stat,source.items[i].stat)))fail();
 const migrations=selectSignedMigrationEntries(entries),history=planMigrationHistory(await Promise.all(migrations.map(async e=>({name:e.path.split('/').pop(),sql:await readVerified(join(root,e.path),e)}))),[]);
 if(history.pending.length!==24||history.pending.some((f,i)=>f.checksum!==migrations[i].sha256))fail();
 const images=await verifyOfflineOciGraph({architecture:p.architecture,entries,readMetadata:async(path,e)=>{const raw=await readVerified(join(root,path),e);rejectDuplicateJsonKeys(raw);return JSON.parse(raw)}});
 const manifest=join(candidate,'manifest.json'),bytes=Buffer.from(JSON.stringify({schema_version:1,installation_mode:'intranet',files:entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)})+'\n');
 if(bytes.length>2*1024*1024)fail();const fd=await open(manifest,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await fd.chmod(0o600);await fd.writeFile(bytes);await fd.sync()}finally{await fd.close()}
 const digest=sha(bytes);const result=await verifyLanBundle({root,manifest,trustedManifestSha256:digest});if(!result.verified||result.files!==entries.length)fail();
 for(const d of [...dirs].sort((a,b)=>b.length-a.length))await syncDir(d);
 await directory(p.destinationParent,true,parent);await syncDir(p.destinationParent);
 return Object.freeze({schema_version:1,candidate_directory:candidate,manifest_sha256:digest,files:entries.length,migrations:24,architecture:p.architecture,oci_descriptor_graph_verified:images.length===3,publisher_signature_verified:false,strict_tar_profile_verified:false,installation_authorized:false,production_accepted:false});
}
