// Create stopped, explicitly activation-blocked containers from a signed
// staged release. Optional rootful profile mounts only pinned identity read-only.
// Never starts services, publishes ports,
// initializes database contents, or authorizes an installation.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import {lstat,realpath,open,readdir} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {validateFreshEnvironmentPolicy,validateFreshEnvironmentText} from './initialize-fresh-compose-environment.mjs';
import {expectedFreshResources,verifyProvisionedNetwork,verifyProvisionedVolume} from './provision-fresh-compose-resources.mjs';
import {inspectBoundOfflineRuntime,selectReleaseStoreIdentity} from './inspect-offline-oci-runtime.mjs';
import {inspectFreshComposeResources} from './fresh-compose-resource-inventory.mjs';
import {socketIdentity,requestLocalDockerJson} from './local-docker-runtime-preflight.mjs';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {admitSignedFreshMigrations} from './initialize-fresh-mysql-schema.mjs';
import {validateRuntimeStoragePolicy,checkOrPrepareFreshRuntimeStorage,runtimeIdentityEnvironment} from './fresh-runtime-storage.mjs';
const exec=promisify(execFile),binary='/usr/bin/docker',socket='/run/docker.sock';
const fail=()=>{throw Error('STOPPED_COMPOSE_CANDIDATES_UNCONFIRMED')};
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const exact=(x,ks)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const roles=['db','api','caddy'],releaseRoles={db:'database',api:'api',caddy:'ingress'};
const targets={db:{mysqldata:'/var/lib/mysql'},api:{api_data:'/data',agent_artifacts:'/artifacts'},caddy:{caddy_data:'/data',caddy_config:'/config'}};
const health={db:'MYSQL_PWD="$MYSQL_PASSWORD" mysql --host=localhost --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --batch --skip-column-names --execute="SELECT 1"',api:"node -e \"fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""};
const secretKeys=['MYSQL_PASSWORD','MYSQL_ROOT_PASSWORD','API_TOKEN','JWT_SECRET','BOOTSTRAP_SECRET','HMAC_SECRET','COMMAND_SIGNING_KEY','SETUP_TOKEN','SESSION_SECRET','DB_PASSWORD'];
const empty=x=>x===null||x===undefined||(Array.isArray(x)?x.length===0:typeof x==='object'&&Object.keys(x).length===0);
const fields=['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'],dirFields=fields.slice(0,4);
const same=(a,b,ks)=>ks.every(k=>a[k]===b[k]);
export function validateStoppedCandidatePolicy(input){
 const bound=input?.confirmation==='CREATE_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY';
 if(!exact(input,['confirmation','project','lockRoot','configDirectory','serverHost','release','configurationSha256','networkId',...(bound?['storage']:[])])||!bound&&input.confirmation!=='CREATE_STOPPED_COMPOSE_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY'||!hex(input.configurationSha256)||!hex(input.networkId))fail();
 const {configurationSha256,networkId,storage,...base}=input;
 const p=validateFreshEnvironmentPolicy({...base,confirmation:'INITIALIZE_EMPTY_COMPOSE_ENVIRONMENT_ONLY_EXCLUSIVE_DAEMON_CUSTODY'});
 return Object.freeze({...p,configurationSha256,networkId,...(bound?{storage:validateRuntimeStoragePolicy(storage,[p.configDirectory,p.lockRoot,p.release.stagedDirectory])}:{})});
}
// This projection is internal to the trusted local adapter. Never log it.
export function deriveCandidateRoleEnvironment(text,project,host){
 validateFreshEnvironmentText(text,project,host);
 const v=Object.fromEntries(text.trimEnd().split('\n').map(x=>x.split('=')));
 return {
  db:{MYSQL_DATABASE:v.MYSQL_DATABASE,MYSQL_USER:v.MYSQL_USER,MYSQL_PASSWORD:v.MYSQL_PASSWORD,MYSQL_ROOT_PASSWORD:v.MYSQL_ROOT_PASSWORD},
  api:{NODE_ENV:'production',PORT:'3000',DB_HOST:'db',DB_PORT:'3306',DB_NAME:v.MYSQL_DATABASE,DB_USER:v.MYSQL_USER,DB_PASSWORD:v.MYSQL_PASSWORD,API_TOKEN:v.API_TOKEN,API_TOKEN_FILE:'/data/api_token',SERVER_HOST:host,JWT_SECRET:v.JWT_SECRET,BOOTSTRAP_SECRET:v.BOOTSTRAP_SECRET,HMAC_SECRET:v.HMAC_SECRET,COMMAND_SIGNING_KEY:v.COMMAND_SIGNING_KEY,SETUP_TOKEN:v.SETUP_TOKEN,SESSION_SECRET:v.SESSION_SECRET,DATA_DIR:'/data',ARTIFACTS_DIR:'/artifacts',ENVIRONMENT:'prod'},
  caddy:{CADDY_HOST:host}
 };
}
function envMap(rows){
 if(!Array.isArray(rows)||rows.length>256)fail();const out=Object.create(null);
 for(const s of rows){if(typeof s!=='string'||s.length>8192||!s.includes('='))fail();const i=s.indexOf('='),k=s.slice(0,i);if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)||Object.hasOwn(out,k))fail();out[k]=s.slice(i+1)}
 return out;
}
// Pin the effective startup contract to the independently verified image. Docker
// represents unset command arrays as null or empty; both have the same meaning.
export function candidateProcessSpec(config){
 if(!config||typeof config!=='object'||Array.isArray(config))fail();
 function argv(value){
  if(value===null||value===undefined)return [];
  if(!Array.isArray(value)||value.length>256||Array.from(value).some(v=>typeof v!=='string'||v.length>8192||v.includes('\x00')))fail();
  if(value.length&&value[0]==='')fail();
  return [...value];
 }
 function scalar(value){
  if(value===null||value===undefined)return '';
  if(typeof value!=='string'||value.length>4096||/[\x00-\x1f\x7f]/.test(value))fail();
  return value;
 }
 const entrypoint=argv(config.Entrypoint),cmd=argv(config.Cmd);
 if(!entrypoint.length&&!cmd.length)fail();
 return {entrypoint,cmd,user:scalar(config.User),workingDir:scalar(config.WorkingDir)||'/'};
}
export function verifyCandidateImage(doc,expectedId,architecture,layers,role){
 if(!roles.includes(role)||!doc||doc.Id!==expectedId||doc.Os!=='linux'||doc.Architecture!==architecture||JSON.stringify(doc.RootFS?.Layers)!==JSON.stringify(layers)||!empty(doc.RepoTags))fail();
 const c=doc.Config;if(!c||!Array.isArray(c.Env??[]))fail();
 const env=envMap(c.Env??[]);
 if(secretKeys.some(k=>Object.hasOwn(env,k))||Object.keys(env).some(k=>k.startsWith('AADITECH_IDENTITY_')||k==='AADITECH_BOUND_REPORTS'||k==='AADITECH_INSTALLATION_ID'))fail();
 if(Object.keys(c.Labels??{}).some(k=>k.startsWith('com.docker.compose.')||k.startsWith('org.aaditech.')))fail();
 if(Object.keys(c.Volumes??{}).some(k=>!Object.values(targets[role]).includes(k)))fail();
 candidateProcessSpec(c);
 return env;
}
export function candidateLabels(project,releaseSha,configSha,role){
 if(!roles.includes(role)||!hex(releaseSha)||!hex(configSha))fail();
 return {'com.docker.compose.project':project,'com.docker.compose.service':role,'com.docker.compose.oneoff':'False','org.aaditech.release-sha256':releaseSha,'org.aaditech.configuration-sha256':configSha,'org.aaditech.activation-blocked':'true'};
}
export function verifyStoppedCandidate(doc,expected){
 const {id,imageId,project,role,networkId,labels,environment,imageEnvironment,imageProcess,identityMount}=expected;
 if(identityMount&&(role!=='api'||doc?.Config?.User!=='1000:1000'))fail();
 const state=doc?.State,c=doc?.Config,h=doc?.HostConfig;
 if(doc?.Id!==id||doc.Image!==imageId||doc.Name!=='/'+project+'-'+role+'-1'||state?.Status!=='created'||state.Running!==false||state.Paused!==false||state.Restarting!==false||state.Dead!==false||!c||!h||Object.entries(labels).some(([k,v])=>c.Labels?.[k]!==v))fail();
 if(!imageProcess||JSON.stringify(candidateProcessSpec(c))!==JSON.stringify(imageProcess))fail();
 if(Object.keys(c.Labels??{}).some(k=>(k.startsWith('com.docker.compose.')||k.startsWith('org.aaditech.'))&&!Object.hasOwn(labels,k)))fail();
 if(h.Privileged!==false||h.PublishAllPorts!==false||!empty(h.PortBindings)||!empty(h.Binds)||!empty(h.CapAdd)||!empty(h.Devices)||!empty(h.DeviceRequests)||h.RestartPolicy?.Name!=='no'||!Array.isArray(h.SecurityOpt)||h.SecurityOpt.length!==1||!['no-new-privileges','no-new-privileges:true','no-new-privileges=true'].includes(h.SecurityOpt[0]))fail();
 // The creator supplies no alternate namespaces, group grants, host lookup,
 // external volume inheritance or kernel tuning. Do not admit such drift.
 if((h.AutoRemove!==undefined&&h.AutoRemove!==false)||[h.PidMode,h.UTSMode,h.UsernsMode,h.CgroupParent].some(v=>v!==undefined&&v!==null&&v!=='')||(h.IpcMode!==undefined&&h.IpcMode!==null&&!['','private'].includes(h.IpcMode))||[h.GroupAdd,h.Links,h.VolumesFrom,h.ExtraHosts,h.Dns,h.DnsOptions,h.DnsSearch,h.Sysctls].some(v=>!empty(v)))fail();
 const actual=envMap(c.Env??[]),wanted={...imageEnvironment,...environment};
 if(Object.entries(wanted).some(([k,v])=>actual[k]!==v)||Object.keys(actual).some(k=>!Object.hasOwn(wanted,k)&&k!=='PATH')||secretKeys.some(k=>Object.hasOwn(actual,k)&&!Object.hasOwn(environment,k)))fail();
 const mounts=doc.Mounts;if(!Array.isArray(mounts)||mounts.length!==Object.keys(targets[role]).length+(identityMount?1:0))fail();
 for(const [name,dest] of Object.entries(targets[role])){
  const matches=mounts.filter(x=>x.Type==='volume'&&x.Name===project+'_'+name&&x.Destination===dest&&x.RW===true&&x.Driver==='local');
  if(matches.length!==1)fail();
 }
 if(!Array.isArray(h.Mounts)||h.Mounts.length!==mounts.length)fail();
 const hostVolumes=h.Mounts.filter(x=>x.Type==='volume');if(hostVolumes.length!==Object.keys(targets[role]).length)fail();
 for(const [name,dest] of Object.entries(targets[role])){
  const matches=hostVolumes.filter(x=>x.Source===project+'_'+name&&x.Target===dest);
  if(matches.length!==1)fail();
  const mount=matches[0],options=mount.VolumeOptions;
  if(options?.NoCopy!==true||(mount.ReadOnly!==undefined&&mount.ReadOnly!==false)||!empty(options.DriverConfig)||!empty(options.Labels)||(options.Subpath!==undefined&&options.Subpath!==null&&options.Subpath!==''))fail();
 }
 if(identityMount){
  const binds=mounts.filter(x=>x.Type==='bind'),options=h.Mounts.filter(x=>x.Type==='bind');
  if(binds.length!==1||options.length!==1||binds[0].Source!==identityMount.source||binds[0].Destination!==identityMount.target||binds[0].RW!==false||binds[0].Propagation!=='rprivate'||options[0].Source!==identityMount.source||options[0].Target!==identityMount.target||options[0].ReadOnly!==true)fail();
 }else if(h.Mounts.some(x=>x.Type!=='volume'))fail();
 const networks=doc.NetworkSettings?.Networks,networkName=project+'_ittoolkit';
 if(!networks||Object.keys(networks).length!==1||!Object.hasOwn(networks,networkName)||![networkName,networkId].includes(h.NetworkMode)||!['',networkId].includes(networks[networkName]?.NetworkID)||!Array.isArray(networks[networkName]?.Aliases)||!networks[networkName].Aliases.includes(role))fail();
 const hc=c.Healthcheck?.Test;
 if(role==='caddy'?JSON.stringify(hc)!==JSON.stringify(['NONE']):JSON.stringify(hc)!==JSON.stringify(['CMD-SHELL',health[role]]))fail();
 return {containerId:id,imageId};
}
async function binaryIdentity(){const s=await lstat(binary);if(!s.isFile()||s.uid!==0||(s.mode&0o022)!==0||(s.mode&0o111)===0||await realpath(binary)!==binary)fail();return [s.dev,s.ino,s.uid,s.mode,s.size,s.mtimeMs,s.ctimeMs]}
async function privateDir(path,expected){const s=await lstat(path);if(!s.isDirectory()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o700||await realpath(path)!==path||expected&&!same(s,expected,dirFields))fail();return s}
async function readPinnedConfig(p,dir){
 await privateDir(p.configDirectory,dir);const names=await readdir(p.configDirectory);if(names.length!==1||names[0]!=='.env')fail();
 const path=join(p.configDirectory,'.env'),fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const s=await fd.stat();if(!s.isFile()||s.uid!==process.geteuid()||(s.mode&0o7777)!==0o600||s.nlink!==1||s.size<1||s.size>4096)fail();
  const buf=Buffer.alloc(s.size+1);let n=0;while(n<buf.length){const r=await fd.read(buf,n,buf.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==s.size||!same(s,await fd.stat(),fields)||!same(s,await lstat(path),fields))fail();
  const text=new TextDecoder('utf-8',{fatal:true}).decode(buf.subarray(0,n));
  if(validateFreshEnvironmentText(text,p.project,p.serverHost).configuration_sha256!==p.configurationSha256)fail();
  await privateDir(p.configDirectory,dir);return text;
 }finally{await fd.close()}
}
export function validateStoppedObservationPolicy(input){
 const bound=input?.confirmation==='INSPECT_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY';
 if(!exact(input,['confirmation','project','lockRoot','configDirectory','serverHost','release','configurationSha256','networkId','containers',...(bound?['storage']:[])])||!bound&&input.confirmation!=='INSPECT_PINNED_STOPPED_COMPOSE_CANDIDATES_ONLY'||!exact(input.containers,roles))fail();
 const pins={};for(const role of roles){const x=input.containers[role];if(!exact(x,['containerId','imageId'])||!hex(x.containerId)||typeof x.imageId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(x.imageId)||!hex(x.imageId.slice(7)))fail();pins[role]=Object.freeze({...x})}
 if(new Set(roles.map(r=>pins[r].containerId)).size!==3||new Set(roles.map(r=>pins[r].imageId)).size!==3)fail();
 const {containers,...base}=input;
 return Object.freeze({...validateStoppedCandidatePolicy({...base,confirmation:bound?'CREATE_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY':'CREATE_STOPPED_COMPOSE_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY'}),containers:Object.freeze(pins)});
}
export async function createStoppedComposeCandidates(input){return stoppedCandidates(input,false)}
export async function inspectStoppedComposeCandidates(input){return stoppedCandidates(input,true)}
async function stoppedCandidates(input,observeOnly){
 if(process.platform!=='linux'||typeof process.geteuid!=='function')fail();
 const p=observeOnly?validateStoppedObservationPolicy(input):validateStoppedCandidatePolicy(input),dir=await privateDir(p.configDirectory);
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:p.lockRoot},async({assertHeld})=>{
  const b=await binaryIdentity(),s=await socketIdentity(),initial=await requestLocalDockerJson(socket,'/info'),daemon=initial.value?.ID;
  if(initial.missing!==false||typeof daemon!=='string'||!daemon||initial.value.OSType!=='linux')fail();
  async function continuity(){await assertHeld();await privateDir(p.configDirectory,dir);if(JSON.stringify(await binaryIdentity())!==JSON.stringify(b)||JSON.stringify(await socketIdentity())!==JSON.stringify(s))fail();const d=await requestLocalDockerJson(socket,'/info');if(d.missing!==false||d.value?.ID!==daemon||d.value.OSType!=='linux'||JSON.stringify(await socketIdentity())!==JSON.stringify(s))fail();await assertHeld();return d}
  async function run(args,environment={}){await continuity();let r;try{r=await exec(binary,['--host','unix:///run/docker.sock',...args],{encoding:'utf8',timeout:30000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_CONFIG:'/nonexistent',...environment}})}catch{fail()}await continuity();return r.stdout}
  async function inspect(type,key){const raw=await run([type,'inspect',key]);rejectDuplicateJsonKeys(raw);const a=JSON.parse(raw);if(!Array.isArray(a)||a.length!==1)fail();return a[0]}
  const config=await readPinnedConfig(p,dir),environments=deriveCandidateRoleEnvironment(config,p.project,p.serverHost);
  if(p.storage){if(process.geteuid()!==0)fail();Object.assign(environments.api,runtimeIdentityEnvironment(p.storage))}
  const bound=await inspectBoundOfflineRuntime(p.release);
  if(!bound.runtime.all_expected_image_ids_observed||!bound.release.release_signature_verified||bound.release.approved_manifest_sha256!==p.release.trustedManifestSha256)fail();
  const store=selectReleaseStoreIdentity(await continuity(),p.release.architecture,bound.release.images);
  if(store.store!==bound.store_profile)fail();
  const resources=expectedFreshResources(p.project,p.release.trustedManifestSha256);
  async function inventory(count){
   await continuity();const r=await inspectFreshComposeResources({confirmation:'INSPECT_FRESH_COMPOSE_RESOURCE_COLLISIONS_ONLY',project:p.project});
   if(r.collision_counts.containers!==count||r.collision_counts.networks!==1||r.collision_counts.volumes!==5)fail();
   // Stopped containers have no active endpoints. Any attached running
   // endpoint is a reconciliation condition, not an activation invitation.
   if(verifyProvisionedNetwork(await inspect('network',p.networkId),resources.network)!==p.networkId)fail();
   for(const v of resources.volumes)verifyProvisionedVolume(await inspect('volume',v.name),v);
   if(await readPinnedConfig(p,dir)!==config)fail();
   await continuity();
  }
  const imageEnvironment={},imageProcesses={};
  async function verifyImages(){
   if(JSON.stringify(selectReleaseStoreIdentity(await continuity(),p.release.architecture,bound.release.images))!==JSON.stringify(store))fail();
   for(const role of roles){
    const rr=releaseRoles[role],release=bound.release.images.find(x=>x.role===rr);
    const doc=await inspect('image',store.imageIds[rr]);if(p.storage&&role==='api'&&doc.Config?.User!=='1000:1000')fail();
    const e=verifyCandidateImage(doc,store.imageIds[rr],p.release.architecture,release.layers.map(x=>x.diff_id),role);
    if(imageEnvironment[role]&&JSON.stringify(e)!==JSON.stringify(imageEnvironment[role]))fail();
    const processSpec=candidateProcessSpec(doc.Config);
    if(imageProcesses[role]&&JSON.stringify(imageProcesses[role])!==JSON.stringify(processSpec))fail();
    imageEnvironment[role]=e;imageProcesses[role]=processSpec;
   }
  }
  const migrationPins={confirmation:'ADMIT_SIGNED_FRESH_MYSQL_MIGRATIONS_ONLY',stagedDirectory:p.release.stagedDirectory,trustedManifestSha256:p.release.trustedManifestSha256,trustedPublicKeyPem:p.release.trustedPublicKeyPem,trustedSignerSpkiSha256:p.release.trustedSignerSpkiSha256};
  const migrations=observeOnly||p.storage?await admitSignedFreshMigrations(migrationPins):null;
  await verifyImages();await inventory(observeOnly?3:0);
  const checkStorage=prepare=>checkOrPrepareFreshRuntimeStorage({storage:p.storage,volumes:resources.volumes,inspect,continuity,prepare});
  const storage=p.storage?await checkStorage(!observeOnly):null;
  const result={},expected={};
  for(const role of roles){
   await inventory(observeOnly?3:Object.keys(result).length);
   for(const k of Object.keys(result))verifyStoppedCandidate(await inspect('container',result[k].containerId),expected[k]);
   const labels=candidateLabels(p.project,p.release.trustedManifestSha256,p.configurationSha256,role),imageId=store.imageIds[releaseRoles[role]],environment=environments[role];
   if(storage){await checkStorage(false);if(role==='api')labels['org.aaditech.identity-sha256']=p.storage.identity.expectedIdentitySha256}
   const identityMount=storage&&role==='api'?{source:storage.source,target:storage.target}:null;
   if(observeOnly){
    const pin=p.containers[role];if(pin.imageId!==imageId)fail();
    expected[role]={id:pin.containerId,imageId,project:p.project,role,networkId:p.networkId,labels,environment,imageEnvironment:imageEnvironment[role],imageProcess:imageProcesses[role],identityMount};
    result[role]=verifyStoppedCandidate(await inspect('container',pin.containerId),expected[role]);continue;
   }
   const args=['container','create','--pull','never','--name',p.project+'-'+role+'-1','--network',p.networkId,'--network-alias',role,'--restart','no','--security-opt','no-new-privileges=true'];
   for(const [k,v] of Object.entries(labels))args.push('--label',k+'='+v);
   for(const [name,destination] of Object.entries(targets[role]))args.push('--mount','type=volume,source='+p.project+'_'+name+',target='+destination+',volume-nocopy');
   if(identityMount)args.push('--mount','type=bind,source='+identityMount.source+',target='+identityMount.target+',readonly,bind-propagation=rprivate');
   // Secret values are supplied only in the child environment, never argv,
   // stdout, error details or the receipt. Docker's privileged metadata
   // necessarily retains container environment; root custody is required.
   for(const key of Object.keys(environment))args.push('--env',key);
   if(role==='caddy')args.push('--no-healthcheck');else args.push('--health-cmd',health[role],'--health-interval','10s','--health-timeout','5s','--health-retries','5');
   args.push(imageId);
   const id=(await run(args,environment)).trim();if(!hex(id))fail();
   expected[role]={id,imageId,project:p.project,role,networkId:p.networkId,labels,environment,imageEnvironment:imageEnvironment[role],imageProcess:imageProcesses[role],identityMount};
   result[role]=verifyStoppedCandidate(await inspect('container',id),expected[role]);
  }
  await inventory(3);
  for(const role of roles)verifyStoppedCandidate(await inspect('container',result[role].containerId),expected[role]);
  await verifyImages();const final=await inspectBoundOfflineRuntime(p.release);if(JSON.stringify(final)!==JSON.stringify(bound))fail();
  if(migrations&&JSON.stringify(await admitSignedFreshMigrations(migrationPins))!==JSON.stringify(migrations))fail();
  if(storage)await checkStorage(false);
  await inventory(3);for(const role of roles)verifyStoppedCandidate(await inspect('container',result[role].containerId),expected[role]);await continuity();
  return {schema_version:1,project:p.project,release_sha256:p.release.trustedManifestSha256,configuration_sha256:p.configurationSha256,network_id:p.networkId,containers:result,containers_created:!observeOnly,stopped_candidates_verified:true,signed_migrations_verified:!!migrations,activation_blocked:true,services_started:false,database_initialized:false,volume_contents_verified:!!storage,api_volume_ownership_verified:!!storage,identity_mount_verified:!!storage,tls_verified:false,installation_authorized:false,production_accepted:false};
 });
}
