// Fresh-only local setup composition. All resource mutations use the
// existing reviewed adapters. Outer lock + separate per-adapter lock;
// exclusive operator/daemon/writer custody is required throughout.
// No resume, rollback, user enrollment, port publication or trust import.
import {constants} from 'node:fs';
import {lstat,realpath,readdir,open} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {isIPv4} from 'node:net';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {inspectLanHost} from './lan-host-preflight.mjs';
import {inspectBoundOfflineRuntime} from './inspect-offline-oci-runtime.mjs';
import {inspectFreshComposeResources} from './fresh-compose-resource-inventory.mjs';
import {socketIdentity,requestLocalDockerJson} from './local-docker-runtime-preflight.mjs';
import {verifyRootfulStorageDaemon} from './fresh-runtime-storage.mjs';
import {initializeLocalInstallationIdentity,inspectLocalInstallationIdentity} from './installation-identity-store-posix.mjs';
import {validateFreshEnvironmentPolicy,initializeFreshComposeEnvironment} from './initialize-fresh-compose-environment.mjs';
import {provisionFreshComposeResources} from './provision-fresh-compose-resources.mjs';
import {admitSignedFreshMigrations} from './initialize-fresh-mysql-schema.mjs';
import {provisionFreshPrivateLanTls,inspectPinnedPrivateLanRuntime} from './provision-fresh-private-lan-tls.mjs';
import {createPrivateStackCandidates,inspectPrivateStackCandidates,initializeStoppedPrivateStack} from './create-stopped-compose-candidates.mjs';
const fail=()=>{throw Error('GUIDED_PRIVATE_STACK_UNCONFIRMED')};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const pathOk=x=>typeof x==='string'&&x.length>1&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f,]/.test(x);
const inside=(a,b)=>{const q=relative(a,b);return q===''||!isAbsolute(q)&&q!=='..'&&!q.startsWith('../')};
const sha=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const dirFields=['dev','ino','uid','gid','mode'],fileFields=[...dirFields,'nlink','size','mtimeMs','ctimeMs'];
const same=(a,b,keys)=>keys.every(k=>a[k]===b[k]);
const dirKeys=['operationLockRoot','adapterLockRoot','journalDirectory','configDirectory','identityDirectory','runtimeIdentityParent','caDirectory','tlsDirectory'];
export const guidedPrivateStackSteps=Object.freeze(['PREFLIGHT','IDENTITY','CONFIGURATION','TLS_MATERIAL','RESOURCES','STOPPED_CANDIDATES','PRIVATE_STACK']);
export function validateGuidedPrivateStackPolicy(input){
 if(!exact(input,['confirmation','project','serverHost','release','directories','host','privateAddress'])||input.confirmation!=='INITIALIZE_GUIDED_EMPTY_PRIVATE_STACK_ONLY_EXCLUSIVE_HOST_DAEMON_AND_WRITER_CUSTODY'||!exact(input.directories,dirKeys)||!exact(input.host,['markerPaths','minCpu','minMemoryBytes','minFreeBytes'])||!exact(input.host.markerPaths,['database','credentials','service']))fail();
 const d=input.directories,h=input.host;
 const p=validateFreshEnvironmentPolicy({confirmation:'INITIALIZE_EMPTY_COMPOSE_ENVIRONMENT_ONLY_EXCLUSIVE_DAEMON_CUSTODY',project:input.project,lockRoot:d.adapterLockRoot,configDirectory:d.configDirectory,serverHost:input.serverHost,release:input.release});
 const dirs=[...dirKeys.map(k=>d[k]),p.release.stagedDirectory,'/var/lib/docker'];
 if(!dirs.every(pathOk)||dirs.some((a,i)=>dirs.some((b,j)=>i!==j&&inside(a,b))))fail();
 if(!Object.values(h.markerPaths).every(pathOk)||new Set(Object.values(h.markerPaths)).size!==3||!Number.isSafeInteger(h.minCpu)||h.minCpu<2||!Number.isSafeInteger(h.minMemoryBytes)||h.minMemoryBytes<4294967296||!Number.isSafeInteger(h.minFreeBytes)||h.minFreeBytes<21474836480)fail();
 if(typeof input.privateAddress!=='string'||!isIPv4(input.privateAddress))fail();
 const [a,b]=input.privateAddress.split('.').map(Number);
 if(a!==10&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168))fail();
 return Object.freeze({project:p.project,serverHost:p.serverHost,release:p.release,directories:Object.freeze({...d}),host:Object.freeze({...h,markerPaths:Object.freeze({...h.markerPaths})}),privateAddress:input.privateAddress});
}
async function directory(path,prior){
 const s=await lstat(path);
 if(!s.isDirectory()||s.uid!==0||(s.mode&0o7777)!==0o700||await realpath(path)!==path||prior&&!same(s,prior,dirFields))fail();
 return s;
}
async function readPrivateFile(path,max){
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const s=await f.stat();
  if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o7777)!==0o600||s.size<1||s.size>max)fail();
  const bytes=Buffer.alloc(s.size+1);let n=0;
  while(n<bytes.length){const r=await f.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==s.size||!same(s,await f.stat(),fileFields)||!same(s,await lstat(path),fileFields))fail();
  return {bytes:bytes.subarray(0,n),stat:s};
 }finally{await f.close()}
}
async function syncDir(path,prior){
 const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{if(!same(prior,await f.stat(),dirFields))fail();await f.sync()}finally{await f.close()}
}
export async function initializeGuidedPrivateStack(input){
 const p=validateGuidedPrivateStackPolicy(input),d=p.directories;
 if(process.platform!=='linux'||process.geteuid?.()!==0)fail();
 // All targets must already exist as distinct empty private directories.
 // Never create arbitrary ancestors or adopt another installation.
 const dirs=new Map();
 for(const k of dirKeys){dirs.set(k,await directory(d[k]));if((await readdir(d[k])).length)fail()}
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:d.operationLockRoot},async({assertHeld})=>{
  const records=new Map(),socket=await socketIdentity(),initial=await requestLocalDockerJson('/run/docker.sock','/info'),daemon=initial.value?.ID;
  if(initial.missing!==false||typeof daemon!=='string'||!daemon||!verifyRootfulStorageDaemon(initial.value))fail();
  let previous='0'.repeat(64),stageIndex=0;
  async function guard(){
   await assertHeld();
   for(const k of dirKeys)await directory(d[k],dirs.get(k));
   if((await readdir(d.adapterLockRoot)).length)fail();
   if(JSON.stringify((await readdir(d.journalDirectory)).sort())!==JSON.stringify([...records.keys()].sort()))fail();
   for(const [name,r] of records){
    const now=await readPrivateFile(join(d.journalDirectory,name),4096);
    if(sha(now.bytes)!==r.digest||!same(now.stat,r.stat,fileFields))fail();
   }
   if(JSON.stringify(await socketIdentity())!==JSON.stringify(socket))fail();
   const current=await requestLocalDockerJson('/run/docker.sock','/info');
   if(current.missing!==false||current.value?.ID!==daemon||!verifyRootfulStorageDaemon(current.value)||JSON.stringify(await socketIdentity())!==JSON.stringify(socket))fail();
   await assertHeld();
  }
  // Append-only, local evidence history for THIS operation, not a resume
  // token or the existing independently signed setup-journal protocol.
  // A STARTED without COMPLETED (or any retained lock) requires review.
  async function record(step,event,evidenceSha256){
   await guard();
   const name='event-'+String(records.size+1).padStart(3,'0')+'.json';
   const bytes=Buffer.from(JSON.stringify({schema_version:1,sequence:records.size+1,project:p.project,release_sha256:p.release.trustedManifestSha256,step,event,previous_sha256:previous,evidence_sha256:evidenceSha256})+'\n');
   const path=join(d.journalDirectory,name),fd=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   let st;
   try{await fd.chmod(0o600);await fd.writeFile(bytes);await fd.sync();st=await fd.stat()}finally{await fd.close()}
   if(!st.isFile()||st.nlink!==1||st.uid!==0||(st.mode&0o7777)!==0o600||st.size!==bytes.length)fail();
   previous=sha(bytes);records.set(name,{digest:previous,stat:st});
   await syncDir(d.journalDirectory,dirs.get('journalDirectory'));await guard();
  }
  async function step(name,action,verify){
   if(guidedPrivateStackSteps[stageIndex]!==name)fail();
   await record(name,'STARTED',sha(Buffer.from(name+':'+p.release.trustedManifestSha256)));
   const receipt=await action();
   await guard();if(!verify(receipt)||receipt.production_accepted===true)fail();
   // Only digests of trusted adapter receipts; never serialize env, PEM,
   // private keys, passwords or arbitrary error details in the journal.
   await record(name,'COMPLETED',sha(Buffer.from(JSON.stringify(receipt))));
   stageIndex++;return receipt;
  }
  const base={project:p.project,lockRoot:d.adapterLockRoot,release:p.release},envBase={...base,serverHost:p.serverHost,configDirectory:d.configDirectory};
  const migrationInput={confirmation:'ADMIT_SIGNED_FRESH_MYSQL_MIGRATIONS_ONLY',stagedDirectory:p.release.stagedDirectory,trustedManifestSha256:p.release.trustedManifestSha256,trustedPublicKeyPem:p.release.trustedPublicKeyPem,trustedSignerSpkiSha256:p.release.trustedSignerSpkiSha256};
  async function emptyProject(){
   const result=await inspectFreshComposeResources({confirmation:'INSPECT_FRESH_COMPOSE_RESOURCE_COLLISIONS_ONLY',project:p.project});
   if(!result.resource_collision_free_observed)fail();
   return result;
  }
  async function observeFreshHost(){
   const host=await inspectLanHost({targetDirectory:d.configDirectory,ports:[443],...p.host});
   const expected={reference_platform:'OBSERVED_LINUX',privilege:'ROOT_OBSERVED',cpu:'MEETS_INPUT_THRESHOLD',physical_memory:'MEETS_INPUT_THRESHOLD',disk:'MEETS_INPUT_THRESHOLD'};
   if(!Object.entries(expected).every(([id,state])=>host.checks.some(x=>x.id===id&&x.state===state))||host.ports.length!==1||host.ports[0].state!=='NO_LISTENER_OBSERVED'||Object.values(host.markers).some(x=>x!=='NOT_OBSERVED'))fail();
   await emptyProject();return host;
  }
  const preflight=await step('PREFLIGHT',async()=>{
   const host=await observeFreshHost(),bound=await inspectBoundOfflineRuntime(p.release),migrations=await admitSignedFreshMigrations(migrationInput);
   if(!bound.release.release_signature_verified||bound.release.approved_manifest_sha256!==p.release.trustedManifestSha256||!bound.runtime.all_expected_image_ids_observed)fail();
   await observeFreshHost();
   return {host,bound,migrations,preflight_verified:true,production_accepted:false};
  },x=>x.preflight_verified===true);
  // Host observations are limited to declared markers and project inventory;
  // never claim global host database/credential absence.
  const identity=await step('IDENTITY',async()=>{
   await observeFreshHost();await guard();
   return initializeLocalInstallationIdentity({confirmation:'INITIALIZE_EMPTY_IDENTITY_STORE_ONLY',directoryPath:d.identityDirectory,observed:{database:'absent',credentials:'absent',service:'absent'}});
  },x=>x.local_identity_verified===true&&x.identity_created===true&&hex(x.identity_sha256));
  const pins={confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:d.identityDirectory,expectedInstallationId:identity.installation_id,expectedIdentitySha256:identity.identity_sha256};
  async function identityGuard(){await guard();await inspectLocalInstallationIdentity(pins)}
  async function releaseGuard(){await identityGuard();if(JSON.stringify(await inspectBoundOfflineRuntime(p.release))!==JSON.stringify(preflight.bound)||JSON.stringify(await admitSignedFreshMigrations(migrationInput))!==JSON.stringify(preflight.migrations))fail();await identityGuard()}
  const config=await step('CONFIGURATION',async()=>{await releaseGuard();await emptyProject();return initializeFreshComposeEnvironment({...envBase,confirmation:'INITIALIZE_EMPTY_COMPOSE_ENVIRONMENT_ONLY_EXCLUSIVE_DAEMON_CUSTODY'})},x=>x.configuration_created===true&&hex(x.configuration_sha256)&&x.release_sha256===p.release.trustedManifestSha256);
  const pki=await step('TLS_MATERIAL',async()=>{await releaseGuard();return provisionFreshPrivateLanTls({confirmation:'PROVISION_EMPTY_PRIVATE_LAN_TLS_ONLY_EXCLUSIVE_WRITER_CUSTODY',lockRoot:d.adapterLockRoot,caDirectory:d.caDirectory,runtimeDirectory:d.tlsDirectory,address:p.privateAddress,hostname:p.serverHost,identity:pins})},x=>x.private_material_verified===true&&x.identity_sha256===identity.identity_sha256&&hex(x.root_sha256)&&hex(x.leaf_sha256)&&hex(x.caddyfile_sha256));
  const rootPem=new TextDecoder('utf-8',{fatal:true}).decode((await readPrivateFile(join(d.caDirectory,'root.crt'),16384)).bytes);
  const tls={runtimeDirectory:d.tlsDirectory,address:p.privateAddress,rootPem,trustedRootSha256:pki.root_sha256,trustedLeafSha256:pki.leaf_sha256,trustedCaddyfileSha256:pki.caddyfile_sha256};
  const tlsInput={confirmation:'INSPECT_PINNED_PRIVATE_LAN_RUNTIME_ONLY',...tls,hostname:p.serverHost,identity:pins};
  const tlsObserved=await inspectPinnedPrivateLanRuntime(tlsInput,identityGuard);
  async function tlsGuard(){await releaseGuard();if(JSON.stringify(await inspectPinnedPrivateLanRuntime(tlsInput,identityGuard))!==JSON.stringify(tlsObserved))fail()}
  const resources=await step('RESOURCES',async()=>{await tlsGuard();return provisionFreshComposeResources({...base,confirmation:'PROVISION_EMPTY_COMPOSE_RESOURCES_ONLY_EXCLUSIVE_DAEMON_CUSTODY'})},x=>x.resources_provisioned===true&&hex(x.network_id)&&x.release_sha256===p.release.trustedManifestSha256);
  const candidateBase={...envBase,configurationSha256:config.configuration_sha256,networkId:resources.network_id,storage:{identity:pins,runtimeIdentityParent:d.runtimeIdentityParent},tls};
  const candidates=await step('STOPPED_CANDIDATES',async()=>{await tlsGuard();return createPrivateStackCandidates({...candidateBase,confirmation:'CREATE_TLS_BOUND_STOPPED_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY'})},x=>x.stopped_candidates_verified===true&&x.private_tls_mount_verified===true&&x.identity_mount_verified===true&&x.services_started===false&&x.network_id===resources.network_id);
  const observation={...candidateBase,containers:candidates.containers};
  const activated=await step('PRIVATE_STACK',async()=>{
   await tlsGuard();
   const observed=await inspectPrivateStackCandidates({...observation,confirmation:'INSPECT_TLS_BOUND_STOPPED_CANDIDATES_ONLY'});
   if(!observed.stopped_candidates_verified||!observed.private_tls_mount_verified||JSON.stringify(observed.containers)!==JSON.stringify(candidates.containers))fail();
   return initializeStoppedPrivateStack({...observation,confirmation:'INITIALIZE_PINNED_FRESH_PRIVATE_STACK_ONLY_EXCLUSIVE_DAEMON_AND_WRITER_CUSTODY'});
  },x=>x.database_initialized===true&&x.api_started===true&&x.ingress_started===true&&x.private_https_readiness_verified===true&&x.host_ports_published===false&&x.identity_sha256===identity.identity_sha256&&x.root_sha256===pki.root_sha256&&x.leaf_sha256===pki.leaf_sha256&&isIPv4(x.private_ingress_address));
  await tlsGuard();if(stageIndex!==guidedPrivateStackSteps.length||records.size!==14)fail();
  return Object.freeze({schema_version:1,project:p.project,server_host:p.serverHost,installation_id:identity.installation_id,identity_sha256:identity.identity_sha256,release_sha256:p.release.trustedManifestSha256,configuration_sha256:config.configuration_sha256,network_id:resources.network_id,containers:activated.containers,private_ingress_address:activated.private_ingress_address,running_pins:activated.running_pins,root_sha256:pki.root_sha256,leaf_sha256:pki.leaf_sha256,caddyfile_sha256:pki.caddyfile_sha256,operation_journal_head_sha256:previous,recorded_steps:stageIndex,private_stack_ready:true,host_database_absence_verified:false,lan_forwarder_started:false,client_trust_installed:false,initial_admin_created:false,resume_authorized:false,installation_authorized:false,production_accepted:false,next_action:'INDEPENDENT_LAN_AND_CLIENT_TRUST_COMMISSIONING_REQUIRED'});
 });
}
