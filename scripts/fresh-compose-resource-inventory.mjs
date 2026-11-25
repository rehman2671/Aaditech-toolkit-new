// Fixed local read-only Docker inventory. No mutation or install authorization.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {socketIdentity,requestLocalDockerJson} from './local-docker-runtime-preflight.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const exec=promisify(execFile),binary='/usr/bin/docker',socket='/run/docker.sock';
const fail=()=>{throw Error('FRESH_COMPOSE_INVENTORY_UNVERIFIED')};
const projectOk=x=>typeof x==='string'&&x.length>=1&&x.length<=48&&/^[a-z0-9][a-z0-9_-]*$/.test(x)&&!/[\r\n]/.test(x);
const name=x=>typeof x==='string'&&x.length<=255&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(x)&&!/[\r\n]/.test(x);
const roles=['db','api','caddy'],volumes=['mysqldata','api_data','caddy_data','caddy_config','agent_artifacts'];
const exact=(o,k)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Reflect.ownKeys(o).length===k.length&&k.every(x=>Object.hasOwn(Object.getOwnPropertyDescriptor(o,x)??{},'value'));
export function classifyFreshComposeInventory(project,rows){
 if(!projectOk(project)||!exact(rows,['containers','networks','volumes'])||Object.values(rows).some(x=>!Array.isArray(x)||x.length>10000))fail();
 const result={containers:0,networks:0,volumes:0};
 for(const row of Array.from(rows.containers)){
  if(!exact(row,['id','name','project'])||typeof row.id!=='string'||row.id.length!==64||!/^[a-f0-9]{64}$/.test(row.id)||!name(row.name)||typeof row.project!=='string'||row.project.length>255)fail();
  if(row.project===project||roles.some(role=>row.name===project+'-'+role+'-1'||row.name===project+'_'+role+'_1'))result.containers++;
 }
 for(const type of ['networks','volumes'])for(const row of Array.from(rows[type])){
  if(!exact(row,['name','project'])||!name(row.name)||typeof row.project!=='string'||row.project.length>255)fail();
  const expected=type==='networks'?['ittoolkit','default']:volumes;
  if(row.project===project||expected.some(x=>row.name===project+'_'+x))result[type]++;
 }
 const clear=Object.values(result).every(x=>x===0);
 return {schema_version:1,decision:clear?'NO_EXPECTED_COMPOSE_RESOURCE_COLLISION_OBSERVED':'EXISTING_RESOURCE_RECONCILIATION_REQUIRED',collision_counts:result,resource_collision_free_observed:clear,host_database_absence_verified:false,credentials_absence_verified:false,installation_authorized:false,production_accepted:false};
}
async function binaryIdentity(){const s=await lstat(binary);if(!s.isFile()||s.uid!==0||(s.mode&0o022)!==0||(s.mode&0o111)===0||await realpath(binary)!==binary)fail();return [s.dev,s.ino,s.uid,s.mode,s.size,s.mtimeMs,s.ctimeMs]}
function parseRows(raw,columns,mapper){
 if(typeof raw!=='string'||raw.length>1048576)fail();if(raw==='')return [];
 const lines=raw.split('\n');if(lines.pop()!=='')fail();
 return lines.map(line=>{const v=line.split('\t');if(v.length!==columns)fail();return mapper(v)});
}
export async function inspectFreshComposeResources(input){
 if(!exact(input,['confirmation','project'])||input.confirmation!=='INSPECT_FRESH_COMPOSE_RESOURCE_COLLISIONS_ONLY'||!projectOk(input.project))fail();
 return observeLocalProject(input.project,false,null);
}
async function observeLocalProject(project,detail,releaseSha256){
 const b=await binaryIdentity(),s=await socketIdentity();
 const initial=await requestLocalDockerJson(socket,'/info'),daemon=initial.value?.ID;
 if(initial.missing!==false||typeof daemon!=='string'||!daemon||initial.value.OSType!=='linux')fail();
 async function continuity(){
  if(JSON.stringify(await binaryIdentity())!==JSON.stringify(b)||JSON.stringify(await socketIdentity())!==JSON.stringify(s))fail();
  const r=await requestLocalDockerJson(socket,'/info');if(r.missing!==false||r.value?.ID!==daemon||r.value.OSType!=='linux')fail();
 }
 async function run(args){await continuity();let r;try{r=await exec(binary,['--host','unix:///run/docker.sock',...args],{encoding:'utf8',timeout:30000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_CONFIG:'/nonexistent'}})}catch{fail()}await continuity();return r.stdout}
 async function observe(){
  const containers=parseRows(await run(['container','ls','--all','--no-trunc','--format','{{.ID}}\t{{.Names}}\t{{.Label "com.docker.compose.project"}}']),3,([id,name,project])=>({id,name,project}));
  const networks=parseRows(await run(['network','ls','--format','{{.Name}}\t{{.Label "com.docker.compose.project"}}']),2,([name,project])=>({name,project}));
  const volumes=parseRows(await run(['volume','ls','--format','{{.Name}}\t{{.Label "com.docker.compose.project"}}']),2,([name,project])=>({name,project}));
  return {containers,networks,volumes};
 }
 const canonical=x=>JSON.stringify(Object.fromEntries(Object.entries(x).map(([k,v])=>[k,v.map(y=>JSON.stringify(y)).sort()])));
 const a=await observe(),b2=await observe();
 if(canonical(a)!==canonical(b2))fail();
 if(!detail){await continuity();return classifyFreshComposeInventory(project,a)}
 const selected=selectProjectCollisions(project,a);
 async function details(){
  const docs={containers:[],networks:[],volumes:[]};
  for(const type of Object.keys(docs)){
   const kind={containers:'container',networks:'network',volumes:'volume'}[type];
   for(const row of selected[type]){
    const raw=await run([kind,'inspect',type==='containers'?row.id:row.name]);
    rejectDuplicateJsonKeys(raw);const values=JSON.parse(raw);
    if(!Array.isArray(values)||values.length!==1)fail();
    docs[type].push(values[0]);
   }
  }
  return classifyProjectRecovery(project,releaseSha256,selected,docs);
 }
 const first=await details(),middle=await observe();
 if(canonical(a)!==canonical(middle))fail();
 const second=await details(),last=await observe();
 if(canonical(a)!==canonical(last)||JSON.stringify(first)!==JSON.stringify(second))fail();
 await continuity();return first;
}
const digest=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const imageId=x=>typeof x==='string'&&x.startsWith('sha256:')&&digest(x.slice(7));
const networkNames=['ittoolkit','default'];
export function selectProjectCollisions(project,rows){
 classifyFreshComposeInventory(project,rows);
 const selected={containers:rows.containers.filter(r=>r.project===project||roles.some(role=>r.name===project+'-'+role+'-1'||r.name===project+'_'+role+'_1')),
  networks:rows.networks.filter(r=>r.project===project||networkNames.some(role=>r.name===project+'_'+role)),
  volumes:rows.volumes.filter(r=>r.project===project||volumes.some(role=>r.name===project+'_'+role))};
 for(const [type,items] of Object.entries(selected)){
  if(items.length>32||new Set(items.map(x=>x.name)).size!==items.length||type==='containers'&&new Set(items.map(x=>x.id)).size!==items.length)fail();
  items.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 }
 return selected;
}
// Reports observed claims, not ownership. Unknown resources and incomplete
// metadata cannot be converted into an approval by a matching label.
export function classifyProjectRecovery(project,releaseSha256,rows,docs){
 if(!digest(releaseSha256)||!exact(docs,['containers','networks','volumes']))fail();
 const selected=selectProjectCollisions(project,rows),result={containers:[],networks:[],volumes:[]};
 for(const [type,items] of Object.entries(selected)){
  if(!Array.isArray(docs[type])||docs[type].length!==items.length||items.length!==rows[type].length)fail();
  for(let i=0;i<items.length;i++){
   const r=items[i],d=docs[type][i];
   if(!d||typeof d!=='object'||Array.isArray(d))fail();
   const labels=type==='containers'?d.Config?.Labels:d.Labels;
   if((labels?.['com.docker.compose.project']??'')!==r.project)fail();
   const claimed=labels?.['com.docker.compose.project']===project&&labels?.['org.aaditech.release-sha256']===releaseSha256;
   if(type==='containers'){
    const role=roles.find(k=>r.name===project+'-'+k+'-1')??null,s=d.State,h=d.HostConfig;
    if(d.Id!==r.id||d.Name!=='/'+r.name||!imageId(d.Image)||!s||!h||typeof s.Running!=='boolean'||typeof s.Status!=='string'||!['created','running','exited','paused','restarting','dead','removing'].includes(s.Status))fail();
    const state=s.Status.toUpperCase(),stable=['CREATED','RUNNING','EXITED'].includes(state)&&s.Paused===false&&s.Restarting===false&&s.Dead===false&&s.Running===(state==='RUNNING');
    const noPorts=h.PublishAllPorts===false&&Object.keys(h.PortBindings??{}).length===0&&Object.values(d.NetworkSettings?.Ports??{}).every(x=>x===null);
    const matched=!!role&&claimed&&labels['com.docker.compose.service']===role&&labels['org.aaditech.activation-blocked']==='true';
    result.containers.push({role,name:r.name,container_id:r.id,image_id:d.Image,state,metadata_matches_expected:matched,stable_state_observed:stable,no_host_ports_observed:noPorts});
   }else if(type==='networks'){
    if(d.Name!==r.name||!digest(d.Id)||!d.Containers||typeof d.Containers!=='object'||Array.isArray(d.Containers))fail();
    const ids=Object.keys(d.Containers).sort();if(ids.length>10000||ids.some(x=>!digest(x)))fail();
    const matched=claimed&&r.name===project+'_ittoolkit'&&labels['com.docker.compose.network']==='ittoolkit'&&d.Driver==='bridge'&&d.Scope==='local'&&d.Internal===true&&d.Attachable===false&&d.Ingress===false;
    result.networks.push({name:r.name,network_id:d.Id,metadata_matches_expected:matched,endpoint_ids:ids});
   }else{
    const role=volumes.find(k=>r.name===project+'_'+k)??null;
    if(d.Name!==r.name)fail();
    const matched=!!role&&claimed&&labels['com.docker.compose.volume']===role&&d.Driver==='local'&&d.Scope==='local'&&(d.Options===null||d.Options&&Object.keys(d.Options).length===0)&&d.Mountpoint==='/var/lib/docker/volumes/'+r.name+'/_data';
    result.volumes.push({role,name:r.name,metadata_matches_expected:!!matched});
   }
  }
 }
 const ids=new Set(result.containers.map(x=>x.container_id));
 const foreignEndpoint=result.networks.some(x=>x.endpoint_ids.some(id=>!ids.has(id)));
 const mismatch=Object.values(result).flat().some(x=>!x.metadata_matches_expected)||result.containers.some(x=>!x.stable_state_observed||!x.no_host_ports_observed)||foreignEndpoint;
 const counts=Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.length]));
 const states=result.containers.map(x=>x.state);
 const shape=Object.values(counts).every(n=>n===0)?'EMPTY':mismatch?'CONFLICT_OR_UNEXPECTED_RESOURCE':counts.networks===1&&counts.volumes===5&&counts.containers===0?'RESOURCES_ONLY':counts.networks===1&&counts.volumes===5&&counts.containers===3&&states.every(x=>x==='CREATED')&&result.networks[0].endpoint_ids.length===0?'ALL_CANDIDATES_CREATED':counts.networks===1&&counts.volumes===5&&counts.containers===3&&states.every(x=>x==='RUNNING')&&result.networks[0].endpoint_ids.length===3?'ALL_CONTAINERS_RUNNING':counts.networks===1&&counts.volumes===5&&counts.containers===3&&states.every(x=>x==='EXITED')&&result.networks[0].endpoint_ids.length===0?'ALL_CONTAINERS_EXITED':'PARTIAL_OR_MIXED';
 return Object.freeze({schema_version:1,project,release_sha256:releaseSha256,shape,counts,resources:result,foreign_endpoint_observed:foreignEndpoint,ownership_verified:false,image_payload_verified:false,storage_contents_verified:false,writer_quiescence_verified:false,mutation_authorized:false,production_accepted:false});
}
export async function inspectProjectRecoveryResources(input){
 if(!exact(input,['confirmation','project','releaseSha256'])||input.confirmation!=='INSPECT_PROJECT_RECOVERY_RESOURCES_ONLY'||!projectOk(input.project)||!digest(input.releaseSha256))fail();
 return observeLocalProject(input.project,true,input.releaseSha256);
}
