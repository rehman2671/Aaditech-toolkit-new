// Fixed local read-only Docker inventory. No mutation or install authorization.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {socketIdentity,requestLocalDockerJson} from './local-docker-runtime-preflight.mjs';
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
 const project=input.project,b=await binaryIdentity(),s=await socketIdentity();
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
 await continuity();return classifyFreshComposeInventory(project,a);
}
