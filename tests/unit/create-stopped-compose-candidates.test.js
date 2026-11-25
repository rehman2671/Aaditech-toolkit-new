import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
import {validateStoppedCandidatePolicy as policy,deriveCandidateRoleEnvironment as derive,verifyCandidateImage as image,candidateProcessSpec as processSpec,freshDatabaseHealthCommand,openPinnedFreshDatabaseConnection as connectDb,verifyRunningFreshDatabase as verifyDb,verifyRunningFreshPair as verifyPair,verifyFreshApiProbeReceipt as probeReceipt,validateFreshApiActivationPolicy as apiPolicy,validateFreshDatabaseActivationPolicy as dbPolicy,candidateLabels as labels,verifyStoppedCandidate as verify,validateStoppedObservationPolicy as observe,validatePrivateStackCreationPolicy as createPrivate,validatePrivateStackObservationPolicy as observePrivate,validatePrivateStackActivationPolicy as activatePrivate,validateLivePrivateStackPolicy as livePrivate,privateCaddyProcessSpec,privateCaddyCommand} from '../../scripts/create-stopped-compose-candidates.mjs';
const sha='a'.repeat(64),networkId='c'.repeat(64),imageId='sha256:'+'d'.repeat(64),id='e'.repeat(64),project='aaditech',host='server.example.com';
const release={confirmation:'INSPECT_SIGNED_OCI_RUNTIME_ONLY',stagedDirectory:'/private/stage',trustedManifestSha256:sha,trustedSignerSpkiSha256:'b'.repeat(64),trustedPublicKeyPem:'fixture',architecture:'amd64'};
const input={confirmation:'CREATE_STOPPED_COMPOSE_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY',project,lockRoot:'/private/lock',configDirectory:'/private/config',serverHost:host,release,configurationSha256:sha,networkId};
const secrets=['MYSQL_PASSWORD','MYSQL_ROOT_PASSWORD','API_TOKEN','JWT_SECRET','BOOTSTRAP_SECRET','HMAC_SECRET','COMMAND_SIGNING_KEY','SETUP_TOKEN','SESSION_SECRET'];
const text=['COMPOSE_PROJECT_NAME='+project,'MYSQL_DATABASE=it_toolkit','MYSQL_USER=itk_user','SERVER_HOST='+host,'CADDY_HOST='+host,'ENVIRONMENT=prod',...secrets.map((k,i)=>k+'='+String(i+1).repeat(64))].join('\n')+'\n';
it('requires explicit stopped-only action and exact config/network pins',()=>expect(policy(input)).toMatchObject({configurationSha256:sha,networkId}));
it.each([{confirmation:'START'},{networkId:'short'},{configurationSha256:'0'.repeat(64)},{configDirectory:'/private/lock'},{project:'../x'},{extra:true}])('rejects bad policy %j',patch=>expect(()=>policy({...input,...patch})).toThrow());
const env=derive(text,project,host);
it('separates database root, API and ingress secrets',()=>{expect(env.db.MYSQL_ROOT_PASSWORD).toBe('2'.repeat(64));expect(env.api.DB_PASSWORD).toBe(env.db.MYSQL_PASSWORD);expect(env.api.MYSQL_ROOT_PASSWORD).toBeUndefined();expect(env.db.JWT_SECRET).toBeUndefined();expect(env.caddy).toEqual({CADDY_HOST:host});expect(env.api.DB_HOST).toBe('db')});
const img={Id:imageId,Os:'linux',Architecture:'amd64',RootFS:{Layers:['sha256:'+sha]},RepoTags:[],Config:{Env:['PATH=/usr/bin'],Cmd:['fixture'],Volumes:{'/var/lib/mysql':{}},Labels:{vendor:'fixture'}}};
it('allows only signed role-specific image volume paths and no embedded runtime secrets',()=>expect(image(img,imageId,'amd64',img.RootFS.Layers,'db').PATH).toBe('/usr/bin'));
it.each([{Env:['MYSQL_ROOT_PASSWORD=bad']},{Volumes:{'/host':{}}},{Labels:{'org.aaditech.activation-blocked':'false'}},{Cmd:[]}])('rejects unsafe image metadata %j',patch=>expect(()=>image({...img,Config:{...img.Config,...patch}},imageId,'amd64',img.RootFS.Layers,'db')).toThrow());
const role='caddy',l=labels(project,sha,sha,role),e={id,imageId,project,role,networkId,labels:l,environment:env.caddy,imageEnvironment:{PATH:'/usr/bin'},imageProcess:processSpec(img.Config)};
const row={Id:id,Image:imageId,Name:'/aaditech-caddy-1',State:{Status:'created',Running:false,Paused:false,Restarting:false,Dead:false},Config:{Cmd:['fixture'],Labels:l,Env:['PATH=/usr/bin','CADDY_HOST='+host],Healthcheck:{Test:['NONE']}},HostConfig:{Privileged:false,PublishAllPorts:false,PortBindings:{},RestartPolicy:{Name:'no'},SecurityOpt:['no-new-privileges=true'],NetworkMode:networkId,Mounts:[{Type:'volume',Source:'aaditech_caddy_data',Target:'/data',VolumeOptions:{NoCopy:true}},{Type:'volume',Source:'aaditech_caddy_config',Target:'/config',VolumeOptions:{NoCopy:true}}]},Mounts:[{Type:'volume',Name:'aaditech_caddy_data',Destination:'/data',RW:true,Driver:'local'},{Type:'volume',Name:'aaditech_caddy_config',Destination:'/config',RW:true,Driver:'local'}],NetworkSettings:{Networks:{aaditech_ittoolkit:{NetworkID:networkId,Aliases:['caddy']}}}};
it('verifies stopped candidate and returns only pinned IDs',()=>expect(verify(row,e)).toEqual({containerId:id,imageId}));
it.each([{Privileged:true},{PublishAllPorts:true},{PortBindings:{'443/tcp':[{HostPort:'443'}]}},{Binds:['/host:/data']},{CapAdd:['ALL']},{RestartPolicy:{Name:'always'}},{SecurityOpt:[]},{NetworkMode:'host'},{Mounts:[{Type:'bind'}]}])('rejects host-config drift %j',patch=>expect(()=>verify({...row,HostConfig:{...row.HostConfig,...patch}},e)).toThrow());
it('rejects activation, extra secrets, mount and network drift',()=>{for(const patch of [{State:{...row.State,Status:'running',Running:true}},{Config:{...row.Config,Env:[...row.Config.Env,'MYSQL_ROOT_PASSWORD=bad']}},{Config:{...row.Config,Labels:{...l,'org.aaditech.activation-blocked':'false'}}},{Mounts:[]},{NetworkSettings:{Networks:{foreign:{}}}},{Name:'/foreign'}])expect(()=>verify({...row,...patch},e)).toThrow()});

const pins=Object.fromEntries(['db','api','caddy'].map((r,i)=>[r,{containerId:String(i+1).repeat(64),imageId:'sha256:'+String(i+4).repeat(64)}]));
const observation={...input,confirmation:'INSPECT_PINNED_STOPPED_COMPOSE_CANDIDATES_ONLY',containers:pins};
it('read-only admission binds independently supplied distinct IDs and freezes them',()=>{const p=observe(observation);expect(p.containers).toEqual(pins);expect(Object.isFrozen(p.containers.db)).toBe(true)});
it.each([{confirmation:'START'},{containers:{...pins,api:pins.db}},{containers:{...pins,db:{...pins.db,extra:true}}},{containers:{...pins,db:{...pins.db,imageId:'latest'}}},{containers:{...pins,db:{...pins.db,containerId:'0'.repeat(64)}}},{containers:{db:pins.db,api:pins.api}}])('rejects unsafe admission pins %j',patch=>expect(()=>observe({...observation,...patch})).toThrow());

it('explicit identity-bound creation validates storage pins and path separation',()=>{const storage={identity:{confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:'/private/id',expectedInstallationId:'12345678-1234-4234-8234-123456789abc',expectedIdentitySha256:sha},runtimeIdentityParent:'/private/runtime-id'};expect(policy({...input,confirmation:'CREATE_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY',storage}).storage).toEqual(storage);expect(()=>policy({...input,storage})).toThrow();expect(()=>policy({...input,confirmation:'CREATE_IDENTITY_BOUND_STOPPED_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY',storage:{...storage,runtimeIdentityParent:input.configDirectory}})).toThrow()});

it('identity mount is accepted only for the API, pinned read-only and non-root',()=>{
 const identityMount={source:'/private/runtime-identity',target:'/run/aaditech-identity'};
 const apiLabels=labels(project,sha,sha,'api'),apiEnv={AADITECH_BOUND_REPORTS:'enabled'};
 const expected={...e,role:'api',labels:apiLabels,environment:apiEnv,imageProcess:processSpec({Cmd:['fixture'],User:'1000:1000'}),identityMount};
 const doc={...row,Name:'/aaditech-api-1',Config:{Cmd:['fixture'],User:'1000:1000',Labels:apiLabels,Env:['PATH=/usr/bin','AADITECH_BOUND_REPORTS=enabled'],Healthcheck:{Test:['CMD-SHELL',"node -e \"fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]}},
 HostConfig:{...row.HostConfig,Mounts:[{Type:'volume',Source:'aaditech_api_data',Target:'/data',VolumeOptions:{NoCopy:true}},{Type:'volume',Source:'aaditech_agent_artifacts',Target:'/artifacts',VolumeOptions:{NoCopy:true}},{Type:'bind',Source:identityMount.source,Target:identityMount.target,ReadOnly:true}]},
 Mounts:[{Type:'volume',Name:'aaditech_api_data',Destination:'/data',RW:true,Driver:'local'},{Type:'volume',Name:'aaditech_agent_artifacts',Destination:'/artifacts',RW:true,Driver:'local'},{Type:'bind',Source:identityMount.source,Destination:identityMount.target,RW:false,Propagation:'rprivate'}],
 NetworkSettings:{Networks:{aaditech_ittoolkit:{NetworkID:networkId,Aliases:['api']}}}};
 expect(verify(doc,expected)).toEqual({containerId:id,imageId});
 for(const patch of [{RW:true},{Source:'/foreign'},{Destination:'/data'},{Propagation:'rshared'}])expect(()=>verify({...doc,Mounts:[...doc.Mounts.slice(0,2),{...doc.Mounts[2],...patch}]},expected)).toThrow();
 expect(()=>verify({...doc,Config:{...doc.Config,User:'root'}},expected)).toThrow();
 expect(()=>verify({...doc,HostConfig:{...doc.HostConfig,Mounts:[...doc.HostConfig.Mounts.slice(0,2),{...doc.HostConfig.Mounts[2],ReadOnly:false}]}},expected)).toThrow();
 expect(()=>verify(doc,{...expected,identityMount:null})).toThrow();
});

describe('signed image startup and stopped container host custody',()=>{
 it('normalizes only unset command arrays and the default working directory',()=>{
  expect(processSpec({Cmd:['fixture',''],Entrypoint:null,User:'',WorkingDir:''})).toEqual(processSpec({Cmd:['fixture',''],Entrypoint:[],WorkingDir:'/'}));
 });
 it.each([{Cmd:['alternate']},{Entrypoint:['/other']},{Cmd:['fixture','unexpected']},{User:'root'},{WorkingDir:'/other'},{Cmd:[]},{Cmd:['fixture',null]},{Cmd:['fixture','x\x00y']}])('rejects unpinned startup drift %j',patch=>{
  expect(()=>verify({...row,Config:{...row.Config,...patch}},e)).toThrow();
 });
 it('rejects missing image process pins and extra reserved ownership labels',()=>{
  expect(()=>verify(row,{...e,imageProcess:undefined})).toThrow();
  for(const key of ['com.docker.compose.unexpected','org.aaditech.identity-sha256']){
   expect(()=>verify({...row,Config:{...row.Config,Labels:{...l,[key]:'other'}}},e)).toThrow();
  }
  expect(verify({...row,Config:{...row.Config,Labels:{...l,vendor:'fixture'}}},e)).toEqual({containerId:id,imageId});
 });
 it.each([
  {SecurityOpt:['no-new-privileges=true','seccomp=unconfined']},
  {SecurityOpt:['no-new-privileges=true','no-new-privileges=true']},
  {SecurityOpt:['no-new-privileges=true','apparmor=unconfined']},
  {PidMode:'host'},{IpcMode:'host'},{UTSMode:'host'},{UsernsMode:'host'},
  {CgroupParent:'/foreign'},{AutoRemove:true},{GroupAdd:['0']},{Links:['other']},
  {VolumesFrom:['foreign']},{ExtraHosts:['db:1.2.3.4']},{Dns:['1.2.3.4']},
  {DnsOptions:['ndots:1']},{DnsSearch:['foreign']},{Sysctls:{'net.ipv4.ip_forward':'1'}}
 ])('rejects unsafe host options %j',patch=>expect(()=>verify({...row,HostConfig:{...row.HostConfig,...patch}},e)).toThrow());
 it.each([
  {Source:'foreign'},{Target:'/foreign'},{ReadOnly:true},{VolumeOptions:{NoCopy:false}},
  {VolumeOptions:{NoCopy:true,DriverConfig:{Name:'other'}}},
  {VolumeOptions:{NoCopy:true,Labels:{unexpected:'x'}}},
  {VolumeOptions:{NoCopy:true,Subpath:'foreign'}}
 ])('rejects host mount drift %j',patch=>{
  const mounts=[{...row.HostConfig.Mounts[0],...patch},row.HostConfig.Mounts[1]];
  expect(()=>verify({...row,HostConfig:{...row.HostConfig,Mounts:mounts}},e)).toThrow();
 });
});

describe('explicit fresh database-only admission',()=>{
 const identity={confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:'/private/id',expectedInstallationId:'12345678-1234-4234-8234-123456789abc',expectedIdentitySha256:sha};
 const activation={...observation,confirmation:'INITIALIZE_PINNED_FRESH_DATABASE_ONLY_EXCLUSIVE_DAEMON_AND_WRITER_CUSTODY',storage:{identity,runtimeIdentityParent:'/private/runtime-id'}};
 it('requires independent container, release, configuration and identity pins',()=>{
  expect(dbPolicy(activation).storage.identity).toEqual(identity);
  expect(()=>dbPolicy(observation)).toThrow();
  const {storage,...without}=activation;
  expect(()=>dbPolicy(without)).toThrow();
 });
 const dbLabels=labels(project,sha,sha,'db');
 const dbExpected={...e,role:'db',labels:dbLabels,environment:env.db};
 const endpoint={NetworkID:networkId,Aliases:['db'],EndpointID:'f'.repeat(64),IPAddress:'172.20.0.2',IPPrefixLen:16,GlobalIPv6Address:''};
 const member={Name:'aaditech-db-1',EndpointID:endpoint.EndpointID,IPv4Address:'172.20.0.2/16',IPv6Address:''};
 const dbDoc={
  ...row,Name:'/aaditech-db-1',RestartCount:0,
  State:{...row.State,Status:'running',Running:true,Pid:123,StartedAt:'2026-11-26T00:00:00Z',Health:{Status:'healthy'}},
  Config:{Cmd:['fixture'],Labels:dbLabels,Env:['PATH=/usr/bin',...Object.entries(env.db).map(([k,v])=>k+'='+v)],Healthcheck:{Test:['CMD-SHELL',freshDatabaseHealthCommand]}},
  HostConfig:{...row.HostConfig,Mounts:[{Type:'volume',Source:'aaditech_mysqldata',Target:'/var/lib/mysql',VolumeOptions:{NoCopy:true}}]},
  Mounts:[{Type:'volume',Name:'aaditech_mysqldata',Destination:'/var/lib/mysql',RW:true,Driver:'local'}],
  NetworkSettings:{Networks:{aaditech_ittoolkit:endpoint}}
 };
 const network={Id:networkId,Name:'aaditech_ittoolkit',Driver:'bridge',Scope:'local',Internal:true,Attachable:false,Ingress:false,Labels:{'com.docker.compose.project':project,'org.aaditech.release-sha256':sha,'com.docker.compose.network':'ittoolkit'},Containers:{[id]:member}};
 it('admits only the pinned DB endpoint and rejects it in the stopped verifier',()=>{
  expect(verifyDb(dbDoc,dbExpected,network)).toMatchObject({ip:endpoint.IPAddress,pid:123,health:'healthy'});
  expect(()=>verify(dbDoc,dbExpected)).toThrow();
 });
 it.each([
  {RestartCount:1},{State:{...dbDoc.State,Pid:0}},
  {State:{...dbDoc.State,Health:{Status:'unhealthy'}}},
  {State:{...dbDoc.State,StartedAt:'invalid'}},
  {HostConfig:{...dbDoc.HostConfig,PublishAllPorts:true}}
 ])('rejects running state or host drift %j',patch=>expect(()=>verifyDb({...dbDoc,...patch},dbExpected,network)).toThrow());
 it.each([
  {Internal:false},{Attachable:true},{Id:'0'.repeat(64)},{Containers:{}},
  {Containers:{...network.Containers,foreign:{}}},
  {Containers:{[id]:{...member,IPv4Address:'172.20.0.9/16'}}},
  {Containers:{[id]:{...member,EndpointID:'c'.repeat(64)}}}
 ])('rejects network membership drift %j',patch=>expect(()=>verifyDb(dbDoc,dbExpected,{...network,...patch})).toThrow());
 it.each(['127.0.0.1','169.254.1.2','8.8.8.8','172.32.0.2','192.169.0.2','::1','db','172.020.0.2'])('rejects nonprivate or nonliteral address %s',async ip=>{
  const d={...dbDoc,NetworkSettings:{Networks:{aaditech_ittoolkit:{...endpoint,IPAddress:ip}}}};
  const n={...network,Containers:{[id]:{...member,IPv4Address:ip+'/16'}}};
  expect(()=>verifyDb(d,dbExpected,n)).toThrow();
  await expect(connectDb(ip,env.db)).rejects.toThrow();
 });
 const apiId='1'.repeat(64),apiImage='sha256:'+'2'.repeat(64),apiLabels=labels(project,sha,sha,'api'),identityMount={source:'/private/runtime-id/runtime-identity',target:'/run/aaditech-identity'};
 const apiEndpoint={...endpoint,Aliases:['api'],EndpointID:'3'.repeat(64),IPAddress:'172.20.0.3'};
 const apiExpected={...e,id:apiId,imageId:apiImage,role:'api',labels:apiLabels,environment:env.api,imageProcess:processSpec({Cmd:['fixture'],User:'1000:1000'}),identityMount};
 const apiDoc={
  ...dbDoc,Id:apiId,Image:apiImage,Name:'/aaditech-api-1',State:{...dbDoc.State,Pid:124},
  Config:{Cmd:['fixture'],User:'1000:1000',Labels:apiLabels,Env:['PATH=/usr/bin',...Object.entries(env.api).map(([k,v])=>k+'='+v)],Healthcheck:{Test:['CMD-SHELL',"node -e \"fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]}},
  HostConfig:{...row.HostConfig,Mounts:[{Type:'volume',Source:'aaditech_api_data',Target:'/data',VolumeOptions:{NoCopy:true}},{Type:'volume',Source:'aaditech_agent_artifacts',Target:'/artifacts',VolumeOptions:{NoCopy:true}},{Type:'bind',Source:identityMount.source,Target:identityMount.target,ReadOnly:true}]},
  Mounts:[{Type:'volume',Name:'aaditech_api_data',Destination:'/data',RW:true,Driver:'local'},{Type:'volume',Name:'aaditech_agent_artifacts',Destination:'/artifacts',RW:true,Driver:'local'},{Type:'bind',Source:identityMount.source,Destination:identityMount.target,RW:false,Propagation:'rprivate'}],
  NetworkSettings:{Networks:{aaditech_ittoolkit:apiEndpoint}}
 };
 const apiMember={Name:'aaditech-api-1',EndpointID:apiEndpoint.EndpointID,IPv4Address:'172.20.0.3/16',IPv6Address:''};
 const pairNetwork={...network,Containers:{[id]:member,[apiId]:apiMember}},pairExpected={db:dbExpected,api:apiExpected};
 it('combined profile has independent explicit confirmation',()=>{
  const both={...activation,confirmation:'INITIALIZE_PINNED_FRESH_DATABASE_AND_API_ONLY_EXCLUSIVE_DAEMON_AND_WRITER_CUSTODY'};
  expect(apiPolicy(both).containers).toEqual(pins);expect(()=>apiPolicy(activation)).toThrow();expect(()=>dbPolicy(both)).toThrow();
 });
 it('accepts exactly the healthy DB and identity-bound API network pair',()=>expect(verifyPair(dbDoc,apiDoc,pairExpected,pairNetwork)).toMatchObject({db:{ip:endpoint.IPAddress},api:{ip:apiEndpoint.IPAddress}}));
 it.each([{Containers:{[id]:member}},{Containers:{[id]:member,[apiId]:apiMember,foreign:{}}},{Containers:{[id]:member,[apiId]:{...apiMember,IPv4Address:'172.20.0.4/16'}}}])('rejects unexpected pair network membership %j',patch=>expect(()=>verifyPair(dbDoc,apiDoc,pairExpected,{...pairNetwork,...patch})).toThrow());
 it.each([{Config:{...apiDoc.Config,User:'root'}},{RestartCount:1},{State:{...apiDoc.State,Pid:123}},{HostConfig:{...apiDoc.HostConfig,PublishAllPorts:true}}])('rejects API process or host drift %j',patch=>expect(()=>verifyPair(dbDoc,{...apiDoc,...patch},pairExpected,pairNetwork)).toThrow());
 it('requires exact non-production API probe proof',()=>{
  const receipt={schema_version:1,non_root_verified:true,identity_verified:true,database_history_verified:true,private_database_verified:true,http_readiness_verified:true,clean_setup_verified:true,production_accepted:false};
  expect(probeReceipt(receipt)).toBe(true);
  for(const key of Object.keys(receipt).filter(k=>k!=='schema_version'&&k!=='production_accepted'))expect(probeReceipt({...receipt,[key]:false})).toBe(false);
  expect(probeReceipt({...receipt,production_accepted:true})).toBe(false);expect(probeReceipt({...receipt,extra:true})).toBe(false);
 });
 it.each([{MYSQL_USER:'root'},{MYSQL_DATABASE:'other'},{MYSQL_PASSWORD:'short'},{MYSQL_PASSWORD:env.db.MYSQL_ROOT_PASSWORD},{extra:true}])('rejects unsafe database connection parameters %j',async patch=>{
  await expect(connectDb('172.20.0.2',{...env.db,...patch})).rejects.toThrow();
 });
});

describe.skipIf(process.platform!=='linux')('explicit TLS-bound fresh stack policy',()=>{
 it('accepts only independently pinned local TLS material and exact fresh profiles',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'private-stack-policy-'));
  try{
   execFileSync('/usr/bin/openssl',['req','-new','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=fixture','-addext','basicConstraints=critical,CA:TRUE','-keyout',join(dir,'key'),'-out',join(dir,'cert')],{stdio:'ignore',timeout:10000});
   const rootPem=await readFile(join(dir,'cert'),'utf8'),trustedRootSha256=createHash('sha256').update(new X509Certificate(rootPem).raw).digest('hex');
   const storage={identity:{confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:'/private/id',expectedInstallationId:'12345678-1234-4234-8234-123456789abc',expectedIdentitySha256:sha},runtimeIdentityParent:'/private/runtime-id'};
   const tls={runtimeDirectory:'/private/tls',address:'127.0.0.1',rootPem,trustedRootSha256,trustedLeafSha256:sha,trustedCaddyfileSha256:sha};
   const create={...input,confirmation:'CREATE_TLS_BOUND_STOPPED_CANDIDATES_ONLY_EXCLUSIVE_DAEMON_CUSTODY',storage,tls};
   expect(createPrivate(create).tls).toEqual(tls);expect(Object.isFrozen(createPrivate(create).tls)).toBe(true);
   const obs={...create,confirmation:'INSPECT_TLS_BOUND_STOPPED_CANDIDATES_ONLY',containers:pins};
   const start={...obs,confirmation:'INITIALIZE_PINNED_FRESH_PRIVATE_STACK_ONLY_EXCLUSIVE_DAEMON_AND_WRITER_CUSTODY'};
   expect(observePrivate(obs).containers).toEqual(pins);expect(activatePrivate(start).storage).toEqual(storage);
   const v=(role,i)=>({path:'/var/lib/docker/volumes/'+project+'_'+role+'/_data',dev:1,ino:i});
   const processes=Object.fromEntries(['db','api','caddy'].map((role,i)=>[role,{ip:'172.20.0.'+(i+2),endpointId:String(i+1).repeat(64),pid:i+10,startedAt:'2026-11-25T00:00:00.000Z',health:role==='caddy'?'requires_https_probe':'healthy'}]));
   const volumes={databaseVolumeIdentity:v('mysqldata',1),apiVolumeIdentities:[v('api_data',2),v('agent_artifacts',3)],caddyVolumeIdentities:[v('caddy_data',4),v('caddy_config',5)]};
   const live={...obs,confirmation:'INSPECT_PINNED_RUNNING_PRIVATE_STACK_ONLY_EXCLUSIVE_DAEMON_CUSTODY',runningPins:{volumes,processes}};
   expect(livePrivate(live).runningPins).toEqual(live.runningPins);
   expect(()=>livePrivate(obs)).toThrow();expect(()=>activatePrivate(live)).toThrow();
   for(const bad of [{volumes:{...volumes,databaseVolumeIdentity:v('foreign',1)}},{volumes:{...volumes,apiVolumeIdentities:[volumes.apiVolumeIdentities[0],volumes.apiVolumeIdentities[0]]}},{processes:{...processes,api:{...processes.api,pid:processes.db.pid}}},{processes:{...processes,caddy:{...processes.caddy,ip:'8.8.8.8'}}},{processes:{...processes,db:{...processes.db,health:'starting'}}}]){
    expect(()=>livePrivate({...live,runningPins:{...live.runningPins,...bad}})).toThrow();
   }
   expect(()=>policy(create)).toThrow();expect(()=>observe(obs)).toThrow();expect(()=>dbPolicy(start)).toThrow();expect(()=>apiPolicy(start)).toThrow();
   expect(()=>activatePrivate(obs)).toThrow();expect(()=>createPrivate(start)).toThrow();
   for(const patch of [{runtimeDirectory:'/private/id'},{runtimeDirectory:'/private/config/tls'},{runtimeDirectory:'/private'},{runtimeDirectory:'/var/lib/docker/volumes/tls'},{runtimeDirectory:'/private/tls,other'},{address:'8.8.8.8'},{trustedRootSha256:'b'.repeat(64)},{trustedLeafSha256:'0'.repeat(64)},{trustedCaddyfileSha256:'short'},{extra:true}]){
    expect(()=>createPrivate({...create,tls:{...tls,...patch}})).toThrow();
   }
  }finally{await rm(dir,{recursive:true,force:true})}
 },20000);
});
it('pins private Caddy process rather than public ACME default',()=>{
 expect(privateCaddyProcessSpec({Cmd:['caddy','run','--config','/etc/caddy/Caddyfile']})).toMatchObject({cmd:privateCaddyCommand,entrypoint:[]});
 for(const patch of [{Entrypoint:['sh']},{User:'1000:1000'}])expect(()=>privateCaddyProcessSpec({Cmd:['caddy'],...patch})).toThrow();
});
