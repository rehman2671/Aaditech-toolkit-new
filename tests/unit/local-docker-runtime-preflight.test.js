import {describe,it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateDockerObservationPolicy as validate,classifyDockerRuntimeObservation as classify,requestLocalDockerJson as get} from '../../scripts/local-docker-runtime-preflight.mjs';
import {parseLocalDockerObservationInput as parse} from '../../scripts/local-docker-runtime-preflight-cli.mjs';
const id=c=>'sha256:'+c.repeat(64);
const policy={confirmation:'OBSERVE_LOCAL_DOCKER_ONLY',architecture:'amd64',imageIds:{api:id('a'),database:id('b'),ingress:id('c')}};
const value=v=>({missing:false,value:v});
const version=value({Os:'linux',Arch:'amd64',ApiVersion:'1.45'});
const info=value({OSType:'linux',Architecture:'x86_64',ID:'private-daemon-id'});
const images=Object.fromEntries(Object.entries(policy.imageIds).map(([k,Id])=>[k,value({Id,Os:'linux',Architecture:'amd64',Config:{Env:['PRIVATE=secret']}})]));
describe('independently pinned Docker observation policy',()=>{
 it('snapshots exact expected IDs and never changes caller data',()=>{
  const input=structuredClone(policy),r=validate(input);input.imageIds.api=id('d');
  expect(r.imageIds.api).toBe(policy.imageIds.api);expect(Object.isFrozen(r.imageIds)).toBe(true);
 });
 for(const [label,input] of [
  ['null',null],['missing confirmation',{...policy,confirmation:undefined}],['wrong confirmation',{...policy,confirmation:true}],
  ['extra top field',{...policy,endpoint:'tcp://localhost'}],['unsupported architecture',{...policy,architecture:'386'}],
  ['architecture coercion',{...policy,architecture:['amd64']}],['missing role',{...policy,imageIds:{api:id('a'),database:id('b')}}],
  ['extra role',{...policy,imageIds:{...policy.imageIds,worker:id('d')}}],['same IDs',{...policy,imageIds:{...policy.imageIds,api:id('b')}}],
  ['inherited record',Object.create(policy)],['getter',{...policy,get architecture(){throw Error('GETTER_INVOKED')}}]
 ])it('rejects '+label,()=>expect(()=>validate(input)).toThrow('DOCKER_OBSERVATION_POLICY_INVALID'));
 for(const role of Object.keys(policy.imageIds))for(const bad of ['latest','sha256:abcd',id('0'),id('A'),id('a')+'\n',null,42])
  it('rejects '+role+' '+JSON.stringify(bad),()=>expect(()=>validate({...policy,imageIds:{...policy.imageIds,[role]:bad}})).toThrow());
 it('reports all exact IDs without leaking config or granting authority',()=>{
  const r=classify(policy,version,info,images);
  expect(r).toMatchObject({decision:'EXTERNAL_REVIEW_REQUIRED',all_expected_image_ids_observed:true,
   image_payload_integrity_verified:false,publisher_signature_verified:false,actual_resource_absence_verified:false,runtime_compatibility_verified:false,installation_authorized:false,production_accepted:false});
  expect(JSON.stringify(r)).not.toContain('PRIVATE');expect(JSON.stringify(r)).not.toContain('private-daemon-id');
 });
 for(const [label,v,i] of [
  ['wrong OS',value({...version.value,Os:'windows'}),info],['wrong architecture',value({...version.value,Arch:'arm64'}),info],
  ['malformed API',value({...version.value,ApiVersion:'1.045'}),info],['info OS',version,value({...info.value,OSType:'windows'})],
  ['info architecture',version,value({...info.value,Architecture:'aarch64'})],['empty daemon ID',version,value({...info.value,ID:''})],
  ['missing version',{missing:true},info],['missing info',version,{missing:true}]
 ])it('blocks '+label,()=>expect(classify(policy,v,i,images).decision).toBe('BLOCKED'));
 for(const role of Object.keys(images))for(const [label,response] of [
  ['missing',{missing:true}],['wrong id',value({...images[role].value,Id:id('d')})],
  ['wrong OS',value({...images[role].value,Os:'windows'})],['wrong arch',value({...images[role].value,Architecture:'arm64'})],
  ['unknown',undefined]
 ])it('blocks '+role+' '+label,()=>{
  const r=classify(policy,version,info,{...images,[role]:response});
  expect(r.decision).toBe('BLOCKED');expect(r.images.find(x=>x.role===role).state).toBe(label==='missing'?'NOT_FOUND':'UNVERIFIED');
 });
 it('accepts a matching arm64 observation without architecture authorization',()=>{
  const p={...policy,architecture:'arm64'};
  const im=Object.fromEntries(Object.entries(images).map(([k,v])=>[k,value({...v.value,Architecture:'arm64'})]));
  expect(classify(p,value({...version.value,Arch:'arm64'}),value({...info.value,Architecture:'aarch64'}),im)).toMatchObject({decision:'EXTERNAL_REVIEW_REQUIRED',runtime_compatibility_verified:false});
 });
});
describe('strict local Docker CLI input',()=>{
 const doc={architecture:policy.architecture,imageIds:policy.imageIds},bytes=Buffer.from(JSON.stringify(doc)),args=['--confirm-local-docker-read-only'];
 it('accepts exact explicit policy',()=>expect(parse(bytes,args)).toEqual(policy));
 for(const [label,b,a] of [
  ['unknown flag',bytes,['--force']],['missing flag',bytes,[]],['oversized',Buffer.alloc(8193),args],
  ['invalid utf8',Buffer.from([255]),args],['empty',Buffer.alloc(0),args],['duplicate key',Buffer.from('{"architecture":"amd64","architecture":"arm64","imageIds":{}}'),args],
  ['endpoint',Buffer.from(JSON.stringify({...doc,socketPath:'/tmp/socket'})),args]
 ])it('refuses '+label,()=>expect(()=>parse(b,a)).toThrow('DOCKER_OBSERVATION_INPUT_INVALID'));
});
async function fixture(handler,fn){
 const dir=await mkdtemp(join(tmpdir(),'docker-observe-')),socket=join(dir,'socket');
 const server=createServer(handler);
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve)});await fn(socket)}
 finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}
}
describe.skipIf(process.platform==='win32')('actual local Unix socket transport',()=>{
 it('uses fixed GET and exact image ID route, not environment endpoints',()=>fixture((req,res)=>{
  expect(req.method).toBe('GET');expect(req.url).toBe('/images/'+id('a')+'/json');
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(images.api.value));
 },async socket=>expect(await get(socket,'/images/'+id('a')+'/json')).toEqual(images.api)));
 it('distinguishes image 404 without trusting error body',()=>fixture((_req,res)=>{res.writeHead(404);res.end('secret')},
  async socket=>expect(await get(socket,'/images/'+id('a')+'/json')).toEqual({missing:true})));
 for(const route of ['/containers/create','/images/create','/images/latest/json','/images/'+id('a')+'/json?x=1','http://example.com','/version/'])
  it('refuses route '+route,async()=>expect(get('/tmp/not-used',route)).rejects.toThrow('DOCKER_OBSERVATION_ROUTE_INVALID'));
 for(const [label,status,headers,body] of [
  ['redirect',302,{Location:'http://127.0.0.1'},''],['server failure',500,{},''],
  ['wrong content type',200,{'Content-Type':'text/html'},'{}'],
  ['gzip',200,{'Content-Type':'application/json','Content-Encoding':'gzip'},'{}'],
  ['duplicate keys',200,{'Content-Type':'application/json'},'{"Id":"a","Id":"b"}'],
  ['array',200,{'Content-Type':'application/json'},'[]'],['malformed',200,{'Content-Type':'application/json'},'{'],
  ['too large',200,{'Content-Type':'application/json'},' '.repeat(1048577)],
  ['invalid UTF8',200,{'Content-Type':'application/json'},Buffer.from([255])]
 ])it('rejects '+label,()=>fixture((_req,res)=>{res.writeHead(status,headers);res.end(body)},
  async socket=>expect(get(socket,'/version')).rejects.toThrow('DOCKER_OBSERVATION_RESPONSE_UNVERIFIED')));
});
