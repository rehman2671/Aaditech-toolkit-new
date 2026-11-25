// Create stopped, explicitly activation-blocked containers from a signed
// staged release. Optional rootful profile mounts only pinned identity read-only.
// Create/inspect never start services. The separately confirmed fresh database
// adapter starts ONLY the pinned database and initializes its signed schema.
// A distinct combined fresh-only profile can also start the pinned API.
// Explicit TLS-bound profile can additionally start private bridge ingress.
// No published host ports, client trust mutation or production authorization.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import {lstat,realpath,open,readdir} from 'node:fs/promises';
import {join,relative,isAbsolute,resolve} from 'node:path';
import {validateFreshEnvironmentPolicy,validateFreshEnvironmentText} from './initialize-fresh-compose-environment.mjs';
import {expectedFreshResources,verifyProvisionedNetwork,verifyProvisionedVolume} from './provision-fresh-compose-resources.mjs';
import {inspectBoundOfflineRuntime,selectReleaseStoreIdentity} from './inspect-offline-oci-runtime.mjs';
import {inspectFreshComposeResources} from './fresh-compose-resource-inventory.mjs';
import {socketIdentity,requestLocalDockerJson} from './local-docker-runtime-preflight.mjs';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {admitSignedFreshMigrations,initializeFreshMySqlSchema,verifyInitializedFreshMySqlSchema} from './initialize-fresh-mysql-schema.mjs';
import {setTimeout as sleep} from 'node:timers/promises';
import {isIPv4} from 'node:net';
import {validateRuntimeStoragePolicy,checkOrPrepareFreshRuntimeStorage,runtimeIdentityEnvironment} from './fresh-runtime-storage.mjs';
import {inspectPinnedPrivateLanRuntime} from './provision-fresh-private-lan-tls.mjs';
import {validatePrivateTlsInputs} from './private-lan-tls-preflight.mjs';
import {probePrivateLanHttps} from './probe-private-lan-https.mjs';
const exec=promisify(execFile),binary='/usr/bin/docker',socket='/run/docker.sock';
const fail=()=>{throw Error('STOPPED_COMPOSE_CANDIDATES_UNCONFIRMED')};
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const exact=(x,ks)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const roles=['db','api','caddy'],releaseRoles={db:'database',api:'api',caddy:'ingress'};
const targets={db:{mysqldata:'/var/lib/mysql'},api:{api_data:'/data',agent_artifacts:'/artifacts'},caddy:{caddy_data:'/data',caddy_config:'/config'}};
export const freshDatabaseHealthCommand='MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP --host=127.0.0.1 --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --batch --skip-column-names --execute="SELECT 1"';
export const freshApiHealthCommand="node -e \"fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"";
const health={db:freshDatabaseHealthCommand,api:freshApiHealthCommand};
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
export function verifyStoppedCandidate(doc,expected){return verifyCandidate(doc,expected,false)}
function verifyCandidate(doc,expected,runningDb){
 const {id,imageId,project,role,networkId,labels,environment,imageEnvironment,imageProcess,identityMount,tlsMount}=expected;
 if(identityMount&&(role!=='api'||doc?.Config?.User!=='1000:1000'))fail();
 if(tlsMount&&(role!=='caddy'||identityMount||tlsMount.target!=='/run/aaditech-tls'||typeof tlsMount.source!=='string'||!['','0','0:0','root'].includes(imageProcess?.user)))fail();
 const privateMount=identityMount||tlsMount;
 const state=doc?.State,c=doc?.Config,h=doc?.HostConfig;
 if(doc?.Id!==id||doc.Image!==imageId||doc.Name!=='/'+project+'-'+role+'-1'||state?.Status!==(runningDb?'running':'created')||state.Running!==runningDb||state.Paused!==false||state.Restarting!==false||state.Dead!==false||!c||!h||Object.entries(labels).some(([k,v])=>c.Labels?.[k]!==v))fail();
 if(!imageProcess||JSON.stringify(candidateProcessSpec(c))!==JSON.stringify(imageProcess)||tlsMount&&(imageProcess.entrypoint.length!==0||JSON.stringify(imageProcess.cmd)!==JSON.stringify(privateCaddyCommand)))fail();
 if(Object.keys(c.Labels??{}).some(k=>(k.startsWith('com.docker.compose.')||k.startsWith('org.aaditech.'))&&!Object.hasOwn(labels,k)))fail();
 if(h.Privileged!==false||h.PublishAllPorts!==false||!empty(h.PortBindings)||!empty(h.Binds)||!empty(h.CapAdd)||!empty(h.Devices)||!empty(h.DeviceRequests)||h.RestartPolicy?.Name!=='no'||!Array.isArray(h.SecurityOpt)||h.SecurityOpt.length!==1||!['no-new-privileges','no-new-privileges:true','no-new-privileges=true'].includes(h.SecurityOpt[0]))fail();
 // The creator supplies no alternate namespaces, group grants, host lookup,
 // external volume inheritance or kernel tuning. Do not admit such drift.
 if((h.AutoRemove!==undefined&&h.AutoRemove!==false)||[h.PidMode,h.UTSMode,h.UsernsMode,h.CgroupParent].some(v=>v!==undefined&&v!==null&&v!=='')||(h.IpcMode!==undefined&&h.IpcMode!==null&&!['','private'].includes(h.IpcMode))||[h.GroupAdd,h.Links,h.VolumesFrom,h.ExtraHosts,h.Dns,h.DnsOptions,h.DnsSearch,h.Sysctls].some(v=>!empty(v)))fail();
 const actual=envMap(c.Env??[]),wanted={...imageEnvironment,...environment};
 if(Object.entries(wanted).some(([k,v])=>actual[k]!==v)||Object.keys(actual).some(k=>!Object.hasOwn(wanted,k)&&k!=='PATH')||secretKeys.some(k=>Object.hasOwn(actual,k)&&!Object.hasOwn(environment,k)))fail();
 const mounts=doc.Mounts;if(!Array.isArray(mounts)||mounts.length!==Object.keys(targets[role]).length+(privateMount?1:0))fail();
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
 if(privateMount){
  const binds=mounts.filter(x=>x.Type==='bind'),options=h.Mounts.filter(x=>x.Type==='bind');
  if(binds.length!==1||options.length!==1||binds[0].Source!==privateMount.source||binds[0].Destination!==privateMount.target||binds[0].RW!==false||binds[0].Propagation!=='rprivate'||options[0].Source!==privateMount.source||options[0].Target!==privateMount.target||options[0].ReadOnly!==true)fail();
 }else if(h.Mounts.some(x=>x.Type!=='volume'))fail();
 const networks=doc.NetworkSettings?.Networks,networkName=project+'_ittoolkit';
 if(!networks||Object.keys(networks).length!==1||!Object.hasOwn(networks,networkName)||![networkName,networkId].includes(h.NetworkMode)||!['',networkId].includes(networks[networkName]?.NetworkID)||!Array.isArray(networks[networkName]?.Aliases)||!networks[networkName].Aliases.includes(role))fail();
 const hc=c.Healthcheck?.Test;
 if(role==='caddy'?JSON.stringify(hc)!==JSON.stringify(['NONE']):JSON.stringify(hc)!==JSON.stringify(['CMD-SHELL',health[role]]))fail();
 return {containerId:id,imageId};
}
// The host bridge address is derived from two independent Docker observations,
// not operator input, a mutable DNS name, a published port, or a returned URL.
function privateIPv4(ip){
 if(typeof ip!=='string'||!isIPv4(ip))fail();
 const [a,b]=ip.split('.').map(Number);
 if(a!==10&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168))fail();
 return ip;
}
export function verifyRunningFreshDatabase(doc,expected,network){
 if(expected.role!=='db')fail();
 return verifyRunningEndpoint(doc,expected,network,[expected.id]);
}
function verifyRunningEndpoint(doc,expected,network,memberIds){
 if(!['db','api','caddy'].includes(expected.role)||expected.role==='api'&&!expected.identityMount||expected.role==='caddy'&&!expected.tlsMount)fail();
 verifyCandidate(doc,expected,true);
 const s=doc.State;
 if(doc.RestartCount!==0||!Number.isSafeInteger(s.Pid)||s.Pid<=0||typeof s.StartedAt!=='string'||!Number.isFinite(Date.parse(s.StartedAt))||(expected.role==='caddy'?s.Health!==undefined&&s.Health!==null:!['starting','healthy'].includes(s.Health?.Status)))fail();
 const resources=expectedFreshResources(expected.project,expected.labels['org.aaditech.release-sha256']);
 if(!network?.Containers||Object.keys(network.Containers).length!==memberIds.length||memberIds.some(id=>!Object.hasOwn(network.Containers,id)))fail();
 if(verifyProvisionedNetwork({...network,Containers:{}},resources.network)!==expected.networkId)fail();
 const endpoint=doc.NetworkSettings.Networks[resources.network.name],member=network.Containers[expected.id],ip=privateIPv4(endpoint?.IPAddress);
 if(endpoint.NetworkID!==expected.networkId||!hex(endpoint.EndpointID)||member?.EndpointID!==endpoint.EndpointID||member.Name!==expected.project+'-'+expected.role+'-1'||endpoint.GlobalIPv6Address!==''&&endpoint.GlobalIPv6Address!==undefined||member.IPv6Address!==''&&member.IPv6Address!==undefined)fail();
 const prefix=endpoint.IPPrefixLen;
 if(!Number.isInteger(prefix)||prefix<8||prefix>30||member.IPv4Address!==ip+'/'+prefix)fail();
 return Object.freeze({ip,endpointId:endpoint.EndpointID,pid:s.Pid,startedAt:s.StartedAt,health:expected.role==='caddy'?'requires_https_probe':s.Health.Status});
}
// Exact pair only: no ingress or third endpoint. The independently verified
// DB and API observations must agree with the same network membership.
export function verifyRunningFreshPair(database,api,expected,network){
 if(expected.db.role!=='db'||expected.api.role!=='api'||expected.db.id===expected.api.id||expected.db.project!==expected.api.project||expected.db.networkId!==expected.api.networkId)fail();
 const ids=[expected.db.id,expected.api.id];
 const db=verifyRunningEndpoint(database,expected.db,network,ids),app=verifyRunningEndpoint(api,expected.api,network,ids);
 if(db.ip===app.ip||db.endpointId===app.endpointId||db.pid===app.pid||db.health!=='healthy')fail();
 return Object.freeze({db,api:app});
}
// Fixed Caddy command, independent from the image's public ACME default.
// This only describes the private candidate. No Docker mutations here.
export const privateCaddyCommand=Object.freeze(['caddy','run','--config','/run/aaditech-tls/Caddyfile','--adapter','caddyfile']);
export function privateCaddyProcessSpec(config){
 const original=candidateProcessSpec(config);
 if(original.entrypoint.length||!['','0','0:0','root'].includes(original.user))fail();
 return {...original,cmd:[...privateCaddyCommand]};
}
export function verifyRunningFreshTriple(database,api,caddy,expected,network){
 const roles=['db','api','caddy'];
 if(roles.some(role=>expected[role]?.role!==role||expected[role].project!==expected.db.project||expected[role].networkId!==expected.db.networkId)||new Set(roles.map(role=>expected[role].id)).size!==3)fail();
 const ids=roles.map(role=>expected[role].id),docs={db:database,api,caddy};
 const result=Object.fromEntries(roles.map(role=>[role,verifyRunningEndpoint(docs[role],expected[role],network,ids)]));
 if(result.db.health!=='healthy'||result.api.health!=='healthy'||['ip','endpointId','pid'].some(key=>new Set(roles.map(role=>result[role][key])).size!==3))fail();
 return Object.freeze(result);
}
// Called after local daemon/network/process admission under exclusive setup custody.
export async function openPinnedFreshDatabaseConnection(ip,environment){
 privateIPv4(ip);
 if(!exact(environment,['MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_ROOT_PASSWORD'])||environment.MYSQL_DATABASE!=='it_toolkit'||environment.MYSQL_USER!=='itk_user'||!hex(environment.MYSQL_PASSWORD)||!hex(environment.MYSQL_ROOT_PASSWORD)||environment.MYSQL_PASSWORD===environment.MYSQL_ROOT_PASSWORD)fail();
 let conn;
 try{
  const {createConnection}=await import('mysql2/promise');
  conn=await createConnection({host:ip,port:3306,user:environment.MYSQL_USER,password:environment.MYSQL_PASSWORD,database:environment.MYSQL_DATABASE,connectTimeout:10000,multipleStatements:true});
  if(conn.connection?.stream?.remoteAddress!==ip||conn.connection?.stream?.remotePort!==3306)fail();
  const [rows]=await conn.query('SELECT DATABASE() AS db,CURRENT_USER() AS account,@@version AS version');
  if(rows?.length!==1||rows[0].db!==environment.MYSQL_DATABASE||typeof rows[0].account!=='string'||!rows[0].account.startsWith(environment.MYSQL_USER+'@')||typeof rows[0].version!=='string'||!/^8\./.test(rows[0].version)||/MariaDB/i.test(rows[0].version))fail();
  return conn;
 }catch{if(conn)try{conn.destroy()}catch{}fail()}
}
export function verifyFreshApiProbeReceipt(receipt){
 const keys=['schema_version','non_root_verified','identity_verified','database_history_verified','private_database_verified','http_readiness_verified','clean_setup_verified','production_accepted'];
 return !!exact(receipt,keys)&&receipt.schema_version===1&&receipt.production_accepted===false&&keys.slice(1,-1).every(k=>receipt[k]===true);
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
export function validateFreshDatabaseActivationPolicy(input){
 if(input?.confirmation!=='INITIALIZE_PINNED_FRESH_DATABASE_ONLY_EXCLUSIVE_DAEMON_AND_WRITER_CUSTODY'||!Object.hasOwn(input,'storage'))fail();
 return validateStoppedObservationPolicy({...input,confirmation:'INSPECT_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY'});
}
export async function initializeStoppedCandidateDatabase(input){
 validateFreshDatabaseActivationPolicy(input);
 // Rebuild the exact accepted observation request; the internal branch is not
 // exposed as a generic callback or arbitrary Docker command adapter.
 return stoppedCandidates({...input,confirmation:'INSPECT_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY'},true,true);
}
export function validateFreshApiActivationPolicy(input){
 if(input?.confirmation!=='INITIALIZE_PINNED_FRESH_DATABASE_AND_API_ONLY_EXCLUSIVE_DAEMON_AND_WRITER_CUSTODY'||!Object.hasOwn(input,'storage'))fail();
 return validateStoppedObservationPolicy({...input,confirmation:'INSPECT_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY'});
}
export async function initializeStoppedCandidateDatabaseAndApi(input){
 validateFreshApiActivationPolicy(input);
 return stoppedCandidates({...input,confirmation:'INSPECT_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY'},true,true,true);
}
// A TLS-bound request is a separate exact profile. The host, identity and
// TLS material pins cannot be independently substituted by another profile.
function validateTlsCandidatePolicy(input,observeOnly,confirmation){
 if(!input||input.confirmation!==confirmation||!Object.hasOwn(input,'tls')||!Object.hasOwn(input,'storage'))fail();
 const {tls,...base}=input;
 const p=observeOnly?validateStoppedObservationPolicy({...base,confirmation:'INSPECT_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY'}):validateStoppedCandidatePolicy({...base,confirmation:'CREATE_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY'});
 if(!exact(tls,['runtimeDirectory','address','rootPem','trustedRootSha256','trustedLeafSha256','trustedCaddyfileSha256'])||typeof tls.runtimeDirectory!=='string'||tls.runtimeDirectory.length>4096||!isAbsolute(tls.runtimeDirectory)||resolve(tls.runtimeDirectory)!==tls.runtimeDirectory||/[\x00-\x1f\x7f,]/.test(tls.runtimeDirectory)||!hex(tls.trustedRootSha256)||!hex(tls.trustedLeafSha256)||!hex(tls.trustedCaddyfileSha256))fail();
 const nested=(a,b)=>{const q=relative(a,b);return q===''||!isAbsolute(q)&&q!=='..'&&!q.startsWith('../')};
 for(const dir of [p.lockRoot,p.configDirectory,p.release.stagedDirectory,p.storage.identity.directoryPath,p.storage.runtimeIdentityParent,'/var/lib/docker']){
  if(nested(dir,tls.runtimeDirectory)||nested(tls.runtimeDirectory,dir))fail();
 }
 const target=validatePrivateTlsInputs({address:tls.address,hostname:p.serverHost,port:443,rootPem:tls.rootPem,trustedRootSha256:tls.trustedRootSha256});
 if(target.hostname!==p.serverHost)fail();
 return Object.freeze({...p,tls:Object.freeze({...tls})});
}
const privateCreateConfirmation='CREATE_TLS_BOUND_STOPPED_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY';
const privateInspectConfirmation='INSPECT_TLS_BOUND_STOPPED_CANDIDATES_ONLY';
const privateActivateConfirmation='INITIALIZE_PINNED_FRESH_PRIVATE_STACK_ONLY_EXCLUSIVE_DAEMON_AND_WRITER_CUSTODY';
export function validatePrivateStackCreationPolicy(input){return validateTlsCandidatePolicy(input,false,privateCreateConfirmation)}
export function validatePrivateStackObservationPolicy(input){return validateTlsCandidatePolicy(input,true,privateInspectConfirmation)}
export function validatePrivateStackActivationPolicy(input){return validateTlsCandidatePolicy(input,true,privateActivateConfirmation)}
export async function createPrivateStackCandidates(input){
 validatePrivateStackCreationPolicy(input);
 return stoppedCandidates(input,false,false,false,true,false);
}
export async function inspectPrivateStackCandidates(input){
 validatePrivateStackObservationPolicy(input);
 return stoppedCandidates(input,true,false,false,true,false);
}
export async function initializeStoppedPrivateStack(input){
 validatePrivateStackActivationPolicy(input);
 return stoppedCandidates(input,true,true,true,true,true);
}
async function stoppedCandidates(input,observeOnly,initializeDatabase=false,initializeApi=false,privateProfile=false,initializeIngress=false){
 if(process.platform!=='linux'||typeof process.geteuid!=='function')fail();
 const p=privateProfile?(initializeIngress?validatePrivateStackActivationPolicy(input):observeOnly?validatePrivateStackObservationPolicy(input):validatePrivateStackCreationPolicy(input)):(observeOnly?validateStoppedObservationPolicy(input):validateStoppedCandidatePolicy(input)),dir=await privateDir(p.configDirectory);
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:p.lockRoot},async({assertHeld})=>{
  const b=await binaryIdentity(),s=await socketIdentity(),initial=await requestLocalDockerJson(socket,'/info'),daemon=initial.value?.ID;
  if(initial.missing!==false||typeof daemon!=='string'||!daemon||initial.value.OSType!=='linux')fail();
  async function continuity(){await assertHeld();await privateDir(p.configDirectory,dir);if(JSON.stringify(await binaryIdentity())!==JSON.stringify(b)||JSON.stringify(await socketIdentity())!==JSON.stringify(s))fail();const d=await requestLocalDockerJson(socket,'/info');if(d.missing!==false||d.value?.ID!==daemon||d.value.OSType!=='linux'||JSON.stringify(await socketIdentity())!==JSON.stringify(s))fail();await assertHeld();return d}
  async function run(args,environment={},timeout=30000){await continuity();let r;try{r=await exec(binary,['--host','unix:///run/docker.sock',...args],{encoding:'utf8',timeout,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_CONFIG:'/nonexistent',...environment}})}catch{fail()}await continuity();return r.stdout}
  async function inspect(type,key){const raw=await run([type,'inspect',key]);rejectDuplicateJsonKeys(raw);const a=JSON.parse(raw);if(!Array.isArray(a)||a.length!==1)fail();return a[0]}
  const config=await readPinnedConfig(p,dir),environments=deriveCandidateRoleEnvironment(config,p.project,p.serverHost);
  if(p.storage){if(process.geteuid()!==0)fail();Object.assign(environments.api,runtimeIdentityEnvironment(p.storage))}
  const bound=await inspectBoundOfflineRuntime(p.release);
  if(!bound.runtime.all_expected_image_ids_observed||!bound.release.release_signature_verified||bound.release.approved_manifest_sha256!==p.release.trustedManifestSha256)fail();
  const store=selectReleaseStoreIdentity(await continuity(),p.release.architecture,bound.release.images);
  if(store.store!==bound.store_profile)fail();
  const resources=expectedFreshResources(p.project,p.release.trustedManifestSha256);
  async function inventory(count,runningDatabase=false){
   await continuity();const r=await inspectFreshComposeResources({confirmation:'INSPECT_FRESH_COMPOSE_RESOURCE_COLLISIONS_ONLY',project:p.project});
   if(r.collision_counts.containers!==count||r.collision_counts.networks!==1||r.collision_counts.volumes!==5)fail();
   // Stopped containers have no active endpoints. Any attached running
   // endpoint is a reconciliation condition, not an activation invitation.
   if(!runningDatabase&&verifyProvisionedNetwork(await inspect('network',p.networkId),resources.network)!==p.networkId)fail();
   for(const v of resources.volumes)verifyProvisionedVolume(await inspect('volume',v.name),v);
   if(await readPinnedConfig(p,dir)!==config)fail();
   await continuity();
  }
  const tlsInput=p.tls?{confirmation:'INSPECT_PINNED_PRIVATE_LAN_RUNTIME_ONLY',...p.tls,hostname:p.serverHost,identity:p.storage.identity}:null;
  const tls=tlsInput?await inspectPinnedPrivateLanRuntime(tlsInput,continuity):null;
  async function verifyTls(){
   if(tls&&JSON.stringify(await inspectPinnedPrivateLanRuntime(tlsInput,continuity))!==JSON.stringify(tls))fail();
  }
  const imageEnvironment={},imageProcesses={},originalProcesses={};
  async function verifyImages(){
   if(JSON.stringify(selectReleaseStoreIdentity(await continuity(),p.release.architecture,bound.release.images))!==JSON.stringify(store))fail();
   for(const role of roles){
    const rr=releaseRoles[role],release=bound.release.images.find(x=>x.role===rr);
    const doc=await inspect('image',store.imageIds[rr]);if(p.storage&&role==='api'&&doc.Config?.User!=='1000:1000')fail();
    const e=verifyCandidateImage(doc,store.imageIds[rr],p.release.architecture,release.layers.map(x=>x.diff_id),role);
    if(imageEnvironment[role]&&JSON.stringify(e)!==JSON.stringify(imageEnvironment[role]))fail();
    const original=candidateProcessSpec(doc.Config),processSpec=tls&&role==='caddy'?privateCaddyProcessSpec(doc.Config):original;
    if(originalProcesses[role]&&JSON.stringify(originalProcesses[role])!==JSON.stringify(original)||imageProcesses[role]&&JSON.stringify(imageProcesses[role])!==JSON.stringify(processSpec))fail();
    originalProcesses[role]=original;imageEnvironment[role]=e;imageProcesses[role]=processSpec;
   }
  }
  const migrationPins={confirmation:'ADMIT_SIGNED_FRESH_MYSQL_MIGRATIONS_ONLY',stagedDirectory:p.release.stagedDirectory,trustedManifestSha256:p.release.trustedManifestSha256,trustedPublicKeyPem:p.release.trustedPublicKeyPem,trustedSignerSpkiSha256:p.release.trustedSignerSpkiSha256};
  const migrations=observeOnly||p.storage?await admitSignedFreshMigrations(migrationPins):null;
  await verifyImages();await inventory(observeOnly?3:0);
  const checkStorage=(prepare,databaseVolumeIdentity,apiVolumeIdentities,caddyVolumeIdentities)=>checkOrPrepareFreshRuntimeStorage({storage:p.storage,volumes:resources.volumes,inspect,continuity,prepare,databaseVolumeIdentity,apiVolumeIdentities,caddyVolumeIdentities});
  const storage=p.storage?await checkStorage(!observeOnly):null;
  const result={},expected={};
  for(const role of roles){
   await inventory(observeOnly?3:Object.keys(result).length);
   for(const k of Object.keys(result))verifyStoppedCandidate(await inspect('container',result[k].containerId),expected[k]);
   const labels=candidateLabels(p.project,p.release.trustedManifestSha256,p.configurationSha256,role),imageId=store.imageIds[releaseRoles[role]],environment=environments[role];
   if(storage){await checkStorage(false);if(role==='api')labels['org.aaditech.identity-sha256']=p.storage.identity.expectedIdentitySha256}
   const identityMount=storage&&role==='api'?{source:storage.source,target:storage.target}:null;
   const tlsMount=tls&&role==='caddy'?{source:tls.source,target:tls.target}:null;
   if(tlsMount){await verifyTls();labels['org.aaditech.tls-leaf-sha256']=tls.leaf_sha256;labels['org.aaditech.caddyfile-sha256']=tls.caddyfile_sha256;}
   if(observeOnly){
    const pin=p.containers[role];if(pin.imageId!==imageId)fail();
    expected[role]={id:pin.containerId,imageId,project:p.project,role,networkId:p.networkId,labels,environment,imageEnvironment:imageEnvironment[role],imageProcess:imageProcesses[role],identityMount,tlsMount};
    result[role]=verifyStoppedCandidate(await inspect('container',pin.containerId),expected[role]);continue;
   }
   const args=['container','create','--pull','never','--name',p.project+'-'+role+'-1','--network',p.networkId,'--network-alias',role,'--restart','no','--security-opt','no-new-privileges=true'];
   for(const [k,v] of Object.entries(labels))args.push('--label',k+'='+v);
   for(const [name,destination] of Object.entries(targets[role]))args.push('--mount','type=volume,source='+p.project+'_'+name+',target='+destination+',volume-nocopy');
   if(identityMount)args.push('--mount','type=bind,source='+identityMount.source+',target='+identityMount.target+',readonly,bind-propagation=rprivate');
   if(tlsMount)args.push('--mount','type=bind,source='+tlsMount.source+',target='+tlsMount.target+',readonly,bind-propagation=rprivate');
   // Secret values are supplied only in the child environment, never argv,
   // stdout, error details or the receipt. Docker's privileged metadata
   // necessarily retains container environment; root custody is required.
   for(const key of Object.keys(environment))args.push('--env',key);
   if(role==='caddy')args.push('--no-healthcheck');else args.push('--health-cmd',health[role],'--health-interval','10s','--health-timeout','5s','--health-retries','5');
   args.push(imageId);if(tlsMount)args.push(...privateCaddyCommand);
   const id=(await run(args,environment)).trim();if(!hex(id))fail();
   expected[role]={id,imageId,project:p.project,role,networkId:p.networkId,labels,environment,imageEnvironment:imageEnvironment[role],imageProcess:imageProcesses[role],identityMount,tlsMount};
   result[role]=verifyStoppedCandidate(await inspect('container',id),expected[role]);
  }
  await inventory(3);
  for(const role of roles)verifyStoppedCandidate(await inspect('container',result[role].containerId),expected[role]);
  await verifyImages();const final=await inspectBoundOfflineRuntime(p.release);if(JSON.stringify(final)!==JSON.stringify(bound))fail();
  if(migrations&&JSON.stringify(await admitSignedFreshMigrations(migrationPins))!==JSON.stringify(migrations))fail();
  if(storage&&JSON.stringify(await checkStorage(false))!==JSON.stringify(storage))fail();
  await verifyTls();
  await inventory(3);for(const role of roles)verifyStoppedCandidate(await inspect('container',result[role].containerId),expected[role]);await continuity();
  if(initializeDatabase){
   if(!observeOnly||!p.storage||!migrations||!storage?.databaseVolumeIdentity)fail();
   // All three exact candidates, empty volumes, signed migrations and identity
   // have just been reobserved while holding THIS same setup lock.
   const dbId=result.db.containerId;
   await run(['container','start',dbId],{},60000);
   let started;
   async function observeDatabase(){
    await inventory(3,true);
    for(const role of ['api','caddy'])verifyStoppedCandidate(await inspect('container',result[role].containerId),expected[role]);
    const d=verifyRunningFreshDatabase(await inspect('container',dbId),expected.db,await inspect('network',p.networkId));
    const {health:status,...pin}=d;
    if(started&&JSON.stringify(pin)!==JSON.stringify(started))fail();
    started=pin;
    return d;
   }
   const deadline=performance.now()+120000;
   while(true){
    const d=await observeDatabase();
    if(d.health==='healthy')break;
    if(performance.now()>deadline)fail();
    await sleep(2000);
   }
   const guard=async()=>{
    await continuity();
    if((await observeDatabase()).health!=='healthy')fail();
    const current=await checkStorage(false,storage.databaseVolumeIdentity);
    if(JSON.stringify(current.apiVolumeIdentities)!==JSON.stringify(storage.apiVolumeIdentities)||JSON.stringify(current.caddyVolumeIdentities)!==JSON.stringify(storage.caddyVolumeIdentities))fail();
    await verifyTls();
    if(await readPinnedConfig(p,dir)!==config)fail();
    await assertHeld();
   };
   // Local private IPv4 bridge only, under trusted exclusive host/daemon and
   // writer custody. No TLS claim. A host unable to reach this bridge fails
   // closed; no port publication, DNS fallback or new network is attempted.
   await guard();
   let conn;
   try{
    conn=await openPinnedFreshDatabaseConnection(started.ip,environments.db);
    await guard();
    const schema=await initializeFreshMySqlSchema(conn,{confirmation:'INITIALIZE_EMPTY_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY',databaseName:environments.db.MYSQL_DATABASE,release:migrationPins,identity:p.storage.identity},guard);
    const admission=await verifyInitializedFreshMySqlSchema(conn,{confirmation:'VERIFY_INITIALIZED_FRESH_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY',databaseName:environments.db.MYSQL_DATABASE,release:migrationPins,identity:p.storage.identity},guard);
    if(admission.installation_id!==schema.installation_id||admission.identity_sha256!==schema.identity_sha256||admission.clean_bootstrap_verified!==true)fail();
    await guard();await verifyImages();
    if(JSON.stringify(await inspectBoundOfflineRuntime(p.release))!==JSON.stringify(bound)||JSON.stringify(await admitSignedFreshMigrations(migrationPins))!==JSON.stringify(migrations))fail();
    await guard();
    await conn.end();conn=undefined;
    await guard();
    let apiReady=false,ingressReady=false,httpsProof=null,ingressAddress=null;
    if(initializeApi){
     if(!storage.apiVolumeIdentities||!admission.clean_bootstrap_verified)fail();
     // The database-only guard stays in force until the explicit API start.
     // No API start is reachable from the database-only confirmation.
     const beforeApi=await checkStorage(false,storage.databaseVolumeIdentity);
     if(JSON.stringify(beforeApi.apiVolumeIdentities)!==JSON.stringify(storage.apiVolumeIdentities))fail();
     await guard();
     await run(['container','start',result.api.containerId],{},60000);
     let apiPin;
     const pairGuard=async(requireHealthy)=>{
      await inventory(3,true);
      verifyStoppedCandidate(await inspect('container',result.caddy.containerId),expected.caddy);
      const pair=verifyRunningFreshPair(await inspect('container',dbId),await inspect('container',result.api.containerId),expected,await inspect('network',p.networkId));
      const {health:dbHealth,...dbPin}=pair.db,{health:apiHealth,...apiCurrent}=pair.api;
      if(dbHealth!=='healthy'||JSON.stringify(dbPin)!==JSON.stringify(started)||apiPin&&JSON.stringify(apiCurrent)!==JSON.stringify(apiPin)||requireHealthy&&apiHealth!=='healthy')fail();
      apiPin=apiCurrent;
      const current=await checkStorage(false,storage.databaseVolumeIdentity,storage.apiVolumeIdentities);
      if(JSON.stringify(current.caddyVolumeIdentities)!==JSON.stringify(storage.caddyVolumeIdentities))fail();
      await verifyTls();await continuity();
      return apiHealth;
     };
     const apiDeadline=performance.now()+120000;
     while(await pairGuard(false)!=='healthy'){
      if(performance.now()>apiDeadline)fail();
      await sleep(2000);
     }
     await pairGuard(true);
     // Fixed signed API image program, no arbitrary shell or secret argv.
     const proofRaw=await run(['container','exec','--user','1000:1000',result.api.containerId,'node','/app/scripts/probe-fresh-api-runtime.mjs',started.ip],{},30000);
     rejectDuplicateJsonKeys(proofRaw);
     if(!verifyFreshApiProbeReceipt(JSON.parse(proofRaw)))fail();
     await pairGuard(true);await verifyImages();
     if(JSON.stringify(await inspectBoundOfflineRuntime(p.release))!==JSON.stringify(bound)||JSON.stringify(await admitSignedFreshMigrations(migrationPins))!==JSON.stringify(migrations))fail();
     await pairGuard(true);
     apiReady=true;
     if(initializeIngress){
      if(!tls||!storage.caddyVolumeIdentities||!apiPin)fail();
      await pairGuard(true);await verifyTls();
      // Start only the already admitted immutable TLS-bound Caddy candidate.
      // Any failure retains the lock and observed resources for reconciliation.
      await run(['container','start',result.caddy.containerId],{},60000);
      let triplePin;
      async function tripleGuard(){
       await inventory(3,true);
       const triple=verifyRunningFreshTriple(await inspect('container',dbId),await inspect('container',result.api.containerId),await inspect('container',result.caddy.containerId),expected,await inspect('network',p.networkId));
       const {health:dbHealth,...dbPin}=triple.db,{health:apiHealth,...appPin}=triple.api;
       if(dbHealth!=='healthy'||apiHealth!=='healthy'||JSON.stringify(dbPin)!==JSON.stringify(started)||JSON.stringify(appPin)!==JSON.stringify(apiPin)||triplePin&&JSON.stringify(triple)!==JSON.stringify(triplePin))fail();
       triplePin=triple;
       await checkStorage(false,storage.databaseVolumeIdentity,storage.apiVolumeIdentities,storage.caddyVolumeIdentities);
       await verifyTls();await continuity();
      }
      await tripleGuard();
      const endpoint={confirmation:'PROBE_PINNED_PRIVATE_LAN_HTTPS_ONLY',address:triplePin.caddy.ip,hostname:p.serverHost,port:443,rootPem:p.tls.rootPem,trustedRootSha256:tls.root_sha256,trustedLeafSha256:tls.leaf_sha256};
      // Read-only readiness retries only; never repeat a container start or
      // swallow a failed custody check. No DNS or unpinned TLS fallback.
      const deadline=performance.now()+30000;
      while(!httpsProof){
       let custodyFailed=false;
       const held=async()=>{try{await tripleGuard()}catch(e){custodyFailed=true;throw e}};
       try{httpsProof=await probePrivateLanHttps(endpoint,held)}catch{if(custodyFailed||performance.now()>deadline)fail();await sleep(500)}
      }
      if(!httpsProof.exact_leaf_verified||!httpsProof.application_readiness_verified||!httpsProof.clean_setup_verified||!httpsProof.private_routes_denied)fail();
      await tripleGuard();await verifyImages();
      if(JSON.stringify(await inspectBoundOfflineRuntime(p.release))!==JSON.stringify(bound)||JSON.stringify(await admitSignedFreshMigrations(migrationPins))!==JSON.stringify(migrations))fail();
      await tripleGuard();ingressAddress=triplePin.caddy.ip;ingressReady=true;
     }
    }
    return Object.freeze({schema_version:1,project:p.project,release_sha256:p.release.trustedManifestSha256,configuration_sha256:p.configurationSha256,network_id:p.networkId,containers:result,database_started:true,database_initialized:true,signed_migrations_verified:true,migrations_applied:schema.migrations_applied,installation_id:schema.installation_id,identity_sha256:schema.identity_sha256,database_binding_verified:schema.database_binding_verified,bootstrap_ready:schema.bootstrap_ready,clean_bootstrap_reobserved:true,api_started:apiReady,api_runtime_identity_verified:apiReady,api_private_database_verified:apiReady,api_http_readiness_verified:apiReady,ingress_started:ingressReady,activation_blocked:true,tls_verified:ingressReady,private_https_readiness_verified:ingressReady,private_routes_denied:ingressReady,host_ports_published:false,client_trust_installed:false,...(httpsProof?{root_sha256:httpsProof.root_sha256,leaf_sha256:httpsProof.leaf_sha256,private_ingress_address:ingressAddress}:{}),installation_authorized:false,production_accepted:false});
   }catch{fail()}finally{if(conn)try{conn.destroy()}catch{}}
  }
  return {schema_version:1,project:p.project,release_sha256:p.release.trustedManifestSha256,configuration_sha256:p.configurationSha256,network_id:p.networkId,containers:result,containers_created:!observeOnly,stopped_candidates_verified:true,signed_migrations_verified:!!migrations,activation_blocked:true,services_started:false,database_initialized:false,volume_contents_verified:!!storage,api_volume_ownership_verified:!!storage,identity_mount_verified:!!storage,private_tls_mount_verified:!!tls,tls_verified:false,installation_authorized:false,production_accepted:false};
 });
}
