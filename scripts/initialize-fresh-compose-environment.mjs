// First-run environment file only. Trusted exclusive local operator custody.
// Does not assert all host data absent, create users/containers, rotate any
// secret, provision TLS, start services, or authorize production installation.
import {constants} from 'node:fs';
import {open,lstat,realpath,readdir,link,unlink} from 'node:fs/promises';
import {isAbsolute,resolve,join,relative} from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {validateFreshResourcePolicy} from './provision-fresh-compose-resources.mjs';
import {inspectBoundOfflineRuntime} from './inspect-offline-oci-runtime.mjs';
import {inspectFreshComposeResources} from './fresh-compose-resource-inventory.mjs';
import {socketIdentity,requestLocalDockerJson} from './local-docker-runtime-preflight.mjs';
const fail=()=>{throw Error('FRESH_COMPOSE_ENVIRONMENT_UNCONFIRMED')};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const secretKeys=Object.freeze(['MYSQL_PASSWORD','MYSQL_ROOT_PASSWORD','API_TOKEN','JWT_SECRET','BOOTSTRAP_SECRET','HMAC_SECRET','COMMAND_SIGNING_KEY','SETUP_TOKEN','SESSION_SECRET']);
const pathOk=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const dns=x=>typeof x==='string'&&x.length<=253&&x.includes('.')&&!/^[0-9.]+$/.test(x)&&x.split('.').every(y=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(y))&&!/\.(localhost|local|test|example|invalid)$/.test(x);
const projectOk=x=>typeof x==='string'&&x.length>=1&&x.length<=48&&/^[a-z0-9][a-z0-9_-]*$/.test(x)&&!/[\r\n]/.test(x);
const nested=(a,b)=>{const q=relative(a,b);return q===''||(!isAbsolute(q)&&q!=='..'&&!q.startsWith('../'))};
const overlap=(a,b)=>nested(a,b)||nested(b,a);
const validSecret=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
export function validateFreshEnvironmentPolicy(input){
 if(!exact(input,['confirmation','project','lockRoot','configDirectory','serverHost','release'])||input.confirmation!=='INITIALIZE_EMPTY_COMPOSE_ENVIRONMENT_ONLY_EXCLUSIVE_DAEMON_CUSTODY'||!pathOk(input.configDirectory)||!dns(input.serverHost))fail();
 const p=validateFreshResourcePolicy({confirmation:'PROVISION_EMPTY_COMPOSE_RESOURCES_ONLY_EXCLUSIVE_DAEMON_CUSTODY',project:input.project,lockRoot:input.lockRoot,release:input.release});
 if(overlap(input.configDirectory,p.lockRoot)||overlap(input.configDirectory,p.release.stagedDirectory)||overlap(p.lockRoot,p.release.stagedDirectory))fail();
 return Object.freeze({...p,configDirectory:input.configDirectory,serverHost:input.serverHost});
}
function fixed(project,serverHost){
 if(!projectOk(project)||!dns(serverHost))fail();
 return {COMPOSE_PROJECT_NAME:project,MYSQL_DATABASE:'it_toolkit',MYSQL_USER:'itk_user',SERVER_HOST:serverHost,CADDY_HOST:serverHost,ENVIRONMENT:'prod'};
}
export function validateFreshEnvironmentText(text,project,serverHost){
 if(typeof text!=='string'||text.length<1||text.length>4096||!text.endsWith('\n')||text.includes('\r'))fail();
 const required=fixed(project,serverHost),values=Object.create(null);
 for(const line of text.slice(0,-1).split('\n')){
  const m=/^([A-Z_][A-Z0-9_]*)=([a-zA-Z0-9_.-]+)$/.exec(line);
  if(!m||Object.hasOwn(values,m[1])||!Object.hasOwn(required,m[1])&&!secretKeys.includes(m[1]))fail();
  values[m[1]]=m[2];
 }
 if(Object.keys(values).length!==Object.keys(required).length+secretKeys.length||Object.entries(required).some(([k,v])=>values[k]!==v)||secretKeys.some(k=>!validSecret(values[k]))||new Set(secretKeys.map(k=>values[k])).size!==secretKeys.length)fail();
 return Object.freeze({configuration_sha256:sha(Buffer.from(text)),project,server_host:serverHost,secret_count:secretKeys.length,canonical_environment_verified:true});
}
function render(project,serverHost){
 const values={...fixed(project,serverHost)};
 for(const key of secretKeys)values[key]=randomBytes(32).toString('hex');
 const text=Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n';
 validateFreshEnvironmentText(text,project,serverHost);return Buffer.from(text);
}
const dirFields=['dev','ino','uid','mode'],fileFields=[...dirFields,'nlink','size','mtimeMs','ctimeMs'];
const same=(a,b,keys)=>keys.every(k=>a[k]===b[k]);
async function privateDir(path,expected){
 const s=await lstat(path);
 if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(path)!==path||expected&&!same(s,expected,dirFields))fail();
 return s;
}
async function verifyFile(path,bytes){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o600||st.nlink!==1||st.size!==bytes.length)fail();
  const buffer=Buffer.alloc(bytes.length+1);let n=0;
  while(n<buffer.length){const r=await fd.read(buffer,n,buffer.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==bytes.length||!buffer.subarray(0,n).equals(bytes)||!same(st,await fd.stat(),fileFields)||!same(st,await lstat(path),fileFields))fail();
 }finally{await fd.close()}
}
export async function initializeFreshComposeEnvironment(input){
 if(process.platform!=='linux'||typeof process.geteuid!=='function')fail();
 const p=validateFreshEnvironmentPolicy(input);
 const dir=await privateDir(p.configDirectory);
 // Reject obviously occupied targets before acquiring a mutation lock.
 if((await readdir(p.configDirectory)).length)fail();
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:p.lockRoot},async({assertHeld})=>{
  const socket=await socketIdentity(),info=await requestLocalDockerJson('/run/docker.sock','/info'),daemon=info.value?.ID;
  if(info.missing!==false||typeof daemon!=='string'||!daemon||info.value.OSType!=='linux')fail();
  async function continuity(){
   await assertHeld();await privateDir(p.configDirectory,dir);
   if(JSON.stringify(await socketIdentity())!==JSON.stringify(socket))fail();
   const d=await requestLocalDockerJson('/run/docker.sock','/info');
   if(d.missing!==false||d.value?.ID!==daemon||d.value.OSType!=='linux'||JSON.stringify(await socketIdentity())!==JSON.stringify(socket))fail();
   await assertHeld();
  }
  async function emptyResources(){
   await continuity();
   const observation=await inspectFreshComposeResources({confirmation:'INSPECT_FRESH_COMPOSE_RESOURCE_COLLISIONS_ONLY',project:p.project});
   if(!observation.resource_collision_free_observed)fail();
   await continuity();
  }
  await continuity();
  const bound=await inspectBoundOfflineRuntime(p.release);
  if(!bound.release.release_signature_verified||bound.release.approved_manifest_sha256!==p.release.trustedManifestSha256||!bound.runtime.all_expected_image_ids_observed)fail();
  await emptyResources();
  if((await readdir(p.configDirectory)).length)fail();
  const bytes=render(p.project,p.serverHost),temp=join(p.configDirectory,'.env.fresh-'+randomUUID()),dest=join(p.configDirectory,'.env');
  let created=false;
  try{
   const fd=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;
   try{await fd.chmod(0o600);await fd.writeFile(bytes);await fd.sync()}finally{await fd.close()}
   await emptyResources();
   const names=await readdir(p.configDirectory);
   if(names.length!==1||names[0]!==temp.split('/').pop())fail();
   await verifyFile(temp,bytes);
   const current=await inspectBoundOfflineRuntime(p.release);
   if(JSON.stringify(current)!==JSON.stringify(bound))fail();
   await continuity();
   // No replacement: an existing credential file is never overwritten.
   await link(temp,dest);
  }finally{if(created){await privateDir(p.configDirectory,dir);await unlink(temp)}}
  const fd=await open(p.configDirectory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{if(!same(dir,await fd.stat(),dirFields))fail();await fd.sync()}finally{await fd.close()}
  await emptyResources();await verifyFile(dest,bytes);
  const names=await readdir(p.configDirectory);
  if(names.length!==1||names[0]!=='.env')fail();
  await continuity();
  return Object.freeze({schema_version:1,...validateFreshEnvironmentText(bytes.toString('utf8'),p.project,p.serverHost),release_sha256:p.release.trustedManifestSha256,configuration_created:true,existing_credentials_rotated:false,host_database_absence_verified:false,containers_created:false,services_started:false,tls_verified:false,installation_authorized:false,production_accepted:false});
 });
}
