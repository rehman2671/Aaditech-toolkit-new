// Rootful local Docker, exclusive operator custody, fresh resources only.
// No recursive chown, adoption, writable identity mount, container start,
// database initialization or recovery. Caller holds the cooperative lock.
import {constants} from 'node:fs';
import {lstat,realpath,open,readdir,mkdir} from 'node:fs/promises';
import {join,resolve,isAbsolute,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectLocalInstallationIdentity} from './installation-identity-store-posix.mjs';
import {validateInstallationIdentity} from './installation-identity.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {verifyProvisionedVolume} from './provision-fresh-compose-resources.mjs';
const fail=()=>{throw Error('FRESH_RUNTIME_STORAGE_UNCONFIRMED')};
const root='/var/lib/docker',uid=1000,gid=1000,file='installation-identity.json';
const dirFields=['dev','ino','uid','gid','mode'],fields=[...dirFields,'nlink','size','mtimeMs','ctimeMs'];
const same=(a,b,k=fields)=>k.every(x=>a[x]===b[x]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const exact=(x,ks)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const pathOk=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f,]/.test(x);
const within=(a,b)=>{const q=relative(a,b);return q===''||!isAbsolute(q)&&q!=='..'&&!q.startsWith('../')};
const overlap=(a,b)=>within(a,b)||within(b,a);
export function validateRuntimeStoragePolicy(input,protectedPaths){
 if(!exact(input,['identity','runtimeIdentityParent'])||!exact(input.identity,['confirmation','directoryPath','expectedInstallationId','expectedIdentitySha256'])||
 input.identity.confirmation!=='INSPECT_PINNED_IDENTITY_STORE_ONLY'||!pathOk(input.identity.directoryPath)||!pathOk(input.runtimeIdentityParent)||
 typeof input.identity.expectedIdentitySha256!=='string'||!/^[a-f0-9]{64}$/.test(input.identity.expectedIdentitySha256)||/^0+$/.test(input.identity.expectedIdentitySha256))fail();
 validateInstallationIdentity({schema_version:1,installation_id:input.identity.expectedInstallationId});
 const dirs=[input.identity.directoryPath,input.runtimeIdentityParent,...protectedPaths,root];
 if(!dirs.every(pathOk)||dirs.some((a,i)=>dirs.some((b,j)=>i!==j&&overlap(a,b))))fail();
 return Object.freeze({identity:Object.freeze({...input.identity}),runtimeIdentityParent:input.runtimeIdentityParent});
}
export function verifyRootfulStorageDaemon(doc){
 if(!doc||doc.OSType!=='linux'||doc.DockerRootDir!==root||!Array.isArray(doc.SecurityOptions)||doc.SecurityOptions.some(x=>typeof x!=='string'||/rootless|userns/i.test(x)))fail();
 return true;
}
export function expectedVolumeMountpoint(doc,expected){
 verifyProvisionedVolume(doc,expected);
 const target=join(root,'volumes',expected.name,'_data');
 if(doc.Mountpoint!==target)fail();return target;
}
export function runtimeIdentityEnvironment(storage){
 return {AADITECH_BOUND_REPORTS:'enabled',AADITECH_IDENTITY_DIRECTORY:'/run/aaditech-identity',AADITECH_INSTALLATION_ID:storage.identity.expectedInstallationId,AADITECH_IDENTITY_SHA256:storage.identity.expectedIdentitySha256};
}
async function directory(path,owner,group,mode,prior){
 const s=await lstat(path);
 if(!s.isDirectory()||await realpath(path)!==path||s.uid!==owner||group!==null&&s.gid!==group||(mode===null?(s.mode&0o7022)!==0:(s.mode&0o7777)!==mode)||prior&&!same(s,prior,dirFields))fail();
 return s;
}
async function noContents(path){if((await readdir(path)).length!==0)fail()}
async function checkRootPath(path){
 // Fixed Docker storage path only, root-owned and not writable by other users.
 for(const part of [root,join(root,'volumes'),resolve(path,'..')])await directory(part,0,null,null);
}
async function emptyVolume(path,api,prepared){
 await checkRootPath(path);
 const s=await directory(path,api&&prepared?uid:0,api&&prepared?gid:null,api&&prepared?0o700:null);
 await noContents(path);return s;
}
async function initApiVolume(path,prior,guard){
 await guard();await checkRootPath(path);
 const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{
  if(!same(prior,await fd.stat(),dirFields)||!same(prior,await lstat(path),dirFields))fail();
  await noContents(path);await fd.chmod(0o700);await fd.chown(uid,gid);await fd.sync();
  const after=await fd.stat();if(after.dev!==prior.dev||after.ino!==prior.ino||after.uid!==uid||after.gid!==gid||(after.mode&0o7777)!==0o700||!same(after,await lstat(path),dirFields))fail();
 }finally{await fd.close()}
 await guard();await emptyVolume(path,true,true);
}
async function readIdentity(path,owner,group,pins){
 const s=await lstat(path);
 if(!s.isFile()||s.uid!==owner||group!==null&&s.gid!==group||(s.mode&0o7777)!==0o600||s.nlink!==1||s.size<1||s.size>1024||await realpath(path)!==path)fail();
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(s,await fd.stat()))fail();const b=Buffer.alloc(s.size+1);let n=0;
  while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  const bytes=b.subarray(0,n);
  if(n!==s.size||!same(s,await fd.stat())||!same(s,await lstat(path))||sha(bytes)!==pins.expectedIdentitySha256)fail();
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(raw);
  if(validateInstallationIdentity(JSON.parse(raw)).installation_id!==pins.expectedInstallationId)fail();
  return bytes;
 }finally{await fd.close()}
}
async function syncDir(path,expected){const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{if(!same(expected,await fd.stat(),dirFields))fail();await fd.sync()}finally{await fd.close()}}
async function sourceIdentity(storage){
 await inspectLocalInstallationIdentity(storage.identity);
 return readIdentity(join(storage.identity.directoryPath,file),0,null,storage.identity);
}
export async function checkOrPrepareFreshRuntimeStorage({storage,volumes,inspect,continuity,prepare,databaseVolumeIdentity}){
 if(process.platform!=='linux'||process.geteuid?.()!==0||typeof inspect!=='function'||typeof continuity!=='function'||typeof prepare!=='boolean')fail();
 if(databaseVolumeIdentity&&(prepare||!exact(databaseVolumeIdentity,['path','dev','ino'])||typeof databaseVolumeIdentity.path!=='string'||!Number.isSafeInteger(databaseVolumeIdentity.dev)||!Number.isSafeInteger(databaseVolumeIdentity.ino)))fail();
 async function observeVolume(path,api,prepared,isDatabase){
  if(!isDatabase||!databaseVolumeIdentity)return emptyVolume(path,api,prepared);
  // The pinned database alone may become populated and change owner after
  // its explicitly admitted first start. It must remain the same directory.
  await checkRootPath(path);const s=await lstat(path);
  if(path!==databaseVolumeIdentity.path||!s.isDirectory()||await realpath(path)!==path||s.dev!==databaseVolumeIdentity.dev||s.ino!==databaseVolumeIdentity.ino||(s.mode&0o7022)!==0)fail();
  return s;
 }
 const parent=await directory(storage.runtimeIdentityParent,0,null,0o700),dest=join(storage.runtimeIdentityParent,'runtime-identity');
 const guard=async()=>{const result=await continuity();verifyRootfulStorageDaemon(result.value);await directory(storage.runtimeIdentityParent,0,null,0o700,parent)};
 await guard();const bytes=await sourceIdentity(storage),records=[];
 for(const v of volumes){
  const role=v.labels['com.docker.compose.volume'],api=['api_data','agent_artifacts'].includes(role);
  if(!['mysqldata','api_data','agent_artifacts','caddy_data','caddy_config'].includes(role))fail();
  const isDatabase=role==='mysqldata',path=expectedVolumeMountpoint(await inspect('volume',v.name),v),stat=await observeVolume(path,api,!prepare,isDatabase);
  records.push({path,api,stat,isDatabase});
 }
 if(records.length!==5||new Set(records.map(x=>x.path)).size!==5||records.filter(x=>x.api).length!==2||records.filter(x=>x.isDatabase).length!==1)fail();
 await guard();
 if(prepare){
  await noContents(storage.runtimeIdentityParent);
  // Verify all five empty volumes and source pins before changing any.
  for(const record of records.filter(x=>x.api))await initApiVolume(record.path,record.stat,guard);
  await guard();await mkdir(dest,{mode:0o700});
  const initial=await directory(dest,0,null,0o700);
  const fd=await open(join(dest,file),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await fd.chmod(0o600);await fd.writeFile(bytes);await fd.chown(uid,gid);await fd.sync()}finally{await fd.close()}
  const dirfd=await open(dest,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{if(!same(initial,await dirfd.stat(),dirFields))fail();await dirfd.chmod(0o700);await dirfd.chown(uid,gid);await dirfd.sync()}finally{await dirfd.close()}
  await syncDir(storage.runtimeIdentityParent,parent);
 }
 await guard();
 const names=await readdir(storage.runtimeIdentityParent);if(names.length!==1||names[0]!=='runtime-identity')fail();
 const d=await directory(dest,uid,gid,0o700);
 const leaves=await readdir(dest);if(leaves.length!==1||leaves[0]!==file)fail();
 if(!(await readIdentity(join(dest,file),uid,gid,storage.identity)).equals(bytes)||!(await sourceIdentity(storage)).equals(bytes))fail();
 await directory(dest,uid,gid,0o700,d);
 for(let i=0;i<records.length;i++){
  const rec=records[i],path=expectedVolumeMountpoint(await inspect('volume',volumes[i].name),volumes[i]),st=await observeVolume(path,rec.api,true,rec.isDatabase);
  if(path!==rec.path||st.dev!==rec.stat.dev||st.ino!==rec.stat.ino)fail();
 }
 await guard();
 const db=records.find(x=>x.isDatabase);
 return Object.freeze({source:dest,target:'/run/aaditech-identity',volume_contents_verified:!databaseVolumeIdentity,api_volume_ownership_verified:true,identity_copy_verified:true,databaseVolumeIdentity:Object.freeze({path:db.path,dev:db.stat.dev,ino:db.stat.ino})});
}
