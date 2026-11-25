import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm,realpath,readFile,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectLanHost,parseLinuxListeningPorts} from '../../scripts/lan-host-preflight.mjs';
describe('read-only LAN host reference checks',()=>{
 it('parses only TCP LISTEN records and fails on malformed rows',()=>{
  const header='sl local_address rem_address st tx_queue';
  const rows='\n 0: 00000000:01BB 00000000:0000 0A 0\n 1: 0100007F:1F90 0100007F:0001 01 0';
  expect([...parseLinuxListeningPorts(header+rows)]).toEqual([443]);
  expect(()=>parseLinuxListeningPorts(header+'\n 0: invalid')).toThrow('UNKNOWN_TCP_TABLE');
 });
 it('checks actual temporary filesystem without reading marker contents or claiming absence',async()=>{
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-host-'));
  try {
   const credential=join(dir,'private');
   await writeFile(credential,'SYNTHETIC SECRET');
   const input={targetDirectory:dir,markerPaths:{database:join(dir,'db'),credentials:credential,service:join(dir,'svc')},ports:[443],minCpu:1,minMemoryBytes:1,minFreeBytes:1};
   const result=await inspectLanHost(input);
   expect(result).toMatchObject({decision:'EXTERNAL_APPROVAL_REQUIRED',markers:{database:'NOT_OBSERVED',credentials:'PRESENT',service:'NOT_OBSERVED'},resource_absence_verified:false,installation_authorized:false});
   expect(JSON.stringify(result)).not.toContain('SYNTHETIC');
   expect(JSON.stringify(result)).not.toContain(dir);
   expect(await readFile(credential,'utf8')).toBe('SYNTHETIC SECRET');
   await expect(inspectLanHost({...input,ports:[443,443]})).rejects.toThrow();
   const low=await inspectLanHost({...input,minFreeBytes:Number.MAX_SAFE_INTEGER});
   expect(low.checks.find(c=>c.id==='disk').state).toBe('INSUFFICIENT');
  } finally {await rm(dir,{recursive:true,force:true})}
 });
});


describe('strict Linux TCP table evidence',()=>{
 const h='sl local_address rem_address st tx_queue';
 const good='0: 00000000:01BB 00000000:0000 0A 0';
 const bad=[
 ['empty',''],['non-string',null],['fake header','x local_address x st'],
 ['wrong order','sl st rem_address local_address'],['substring header','sl local_addressx rem_address st'],
 ['missing peer column','sl local_address st'],['missing state',h+'\n0: 00000000:01BB 00000000:0000'],
 ['bad slot',h+'\nx: 00000000:01BB 00000000:0000 0A'],
 ['bad local hex',h+'\n'+good.replace('00000000:01BB','G0000000:01BB')],
 ['bad peer hex',h+'\n'+good.replace('00000000:0000','G0000000:0000')],
 ['bad local port',h+'\n'+good.replace(':01BB',':1BB')],
 ['bad peer port',h+'\n'+good.replace(':0000',':000')],
 ['mixed peer family',h+'\n'+good.replace('00000000:0000','0'.repeat(32)+':0000')],
 ['mixed row family',h+'\n'+good+'\n1: '+'0'.repeat(32)+':01BB '+'0'.repeat(32)+':0000 0A'],
 ['zero state',h+'\n'+good.replace(' 0A ',' 00 ')],
 ['unknown state',h+'\n'+good.replace(' 0A ',' FF ')],
 ['invalid state',h+'\n'+good.replace(' 0A ',' XX ')],
 ['zero listen port',h+'\n'+good.replace(':01BB',':0000')],
 ['nonzero listen peer address',h+'\n'+good.replace('00000000:0000','0100007F:0000')],
 ['nonzero listen peer port',h+'\n'+good.replace('00000000:0000','00000000:0001')],
 ['non-ASCII',h+'\n'+good+'\u00a0'],
 ['NUL',h+'\n'+good+'\0'],['bare CR',h+'\r'+good],
 ['internal blank row',h+'\n'+good+'\n\n'+good],
 ['over limit',h+'\n'+' '.repeat(4*1024*1024)]
 ];
 it.each(bad)('rejects %s',(_name,text)=>expect(()=>parseLinuxListeningPorts(text)).toThrow('UNKNOWN_TCP_TABLE'));
 it('checks requested address family and permits native IPv6 header',()=>{
   const row='0: '+'0'.repeat(32)+':01BB '+'0'.repeat(32)+':0000 0A';
   const header='sl local_address remote_address st';
   expect([...parseLinuxListeningPorts(header+'\n'+row,32)]).toEqual([443]);
   expect(()=>parseLinuxListeningPorts(header+'\n'+row,8)).toThrow('UNKNOWN_TCP_TABLE');
   expect(()=>parseLinuxListeningPorts(h+'\n'+good,32)).toThrow('UNKNOWN_TCP_TABLE');
   expect(()=>parseLinuxListeningPorts(h,16)).toThrow('UNKNOWN_TCP_TABLE');
 });
 it('accepts header-only, CRLF and lowercase hexadecimal rows',()=>{
   expect([...parseLinuxListeningPorts(h,8)]).toEqual([]);
   expect([...parseLinuxListeningPorts(h+'\r\n'+good.toLowerCase(),8)]).toEqual([443]);
 });
});

describe('strict host policy and immutable observations',()=>{
 const base=()=>{const dir=tmpdir();return {targetDirectory:dir,markerPaths:{database:join(dir,'itk-db'),credentials:join(dir,'itk-key'),service:join(dir,'itk-svc')},ports:[443],minCpu:1,minMemoryBytes:1,minFreeBytes:1}};
 const invalid=[
 ['null',()=>null],['array',()=>[]],['extra field',o=>({...o,unexpected:true})],
 ['missing field',o=>{delete o.minCpu;return o}],['inherited policy',o=>Object.create(o)],
 ['hidden field',o=>Object.defineProperty(o,'hidden',{value:true})],
 ['symbol field',o=>({...o,[Symbol('extra')]:true})],
 ['relative directory',o=>({...o,targetDirectory:'relative'})],
 ['noncanonical directory',o=>({...o,targetDirectory:o.targetDirectory+'/../tmp'})],
 ['NUL directory',o=>({...o,targetDirectory:o.targetDirectory+'\0'})],
 ['newline directory',o=>({...o,targetDirectory:o.targetDirectory+'\n'})],
 ['oversized path',o=>({...o,targetDirectory:'/'+ 'x'.repeat(4096)})],
 ['null markers',o=>({...o,markerPaths:null})],
 ['inherited markers',o=>({...o,markerPaths:Object.create(o.markerPaths)})],
 ['extra marker',o=>({...o,markerPaths:{...o.markerPaths,extra:'x'}})],
 ['relative marker',o=>({...o,markerPaths:{...o.markerPaths,database:'relative'}})],
 ['duplicate markers',o=>({...o,markerPaths:{...o.markerPaths,database:o.markerPaths.credentials}})],
 ['control marker',o=>({...o,markerPaths:{...o.markerPaths,service:o.markerPaths.service+'\t'}})],
 ['empty ports',o=>({...o,ports:[]})],['sparse ports',o=>({...o,ports:Array(1)})],
 ['partly sparse ports',o=>({...o,ports:[443,,8443]})],
 ['port extras',o=>({...o,ports:Object.assign([443],{extra:true})})],
 ['duplicate ports',o=>({...o,ports:[443,443]})],['too many ports',o=>({...o,ports:Array.from({length:33},(_,i)=>i+1)})],
 ['string port',o=>({...o,ports:['443']})],['zero port',o=>({...o,ports:[0]})],
 ['overflow port',o=>({...o,ports:[65536]})],['fractional port',o=>({...o,ports:[1.5]})],
 ['zero CPU',o=>({...o,minCpu:0})],['negative CPU',o=>({...o,minCpu:-1})],
 ['string CPU',o=>({...o,minCpu:'1'})],['fractional memory',o=>({...o,minMemoryBytes:1.5})],
 ['NaN memory',o=>({...o,minMemoryBytes:NaN})],['infinite disk',o=>({...o,minFreeBytes:Infinity})],
 ['unsafe disk',o=>({...o,minFreeBytes:Number.MAX_SAFE_INTEGER+1})]
 ];
 it.each(invalid)('rejects %s before observation',async(_name,change)=>{
   await expect(inspectLanHost(change(base()))).rejects.toThrow('EXPLICIT_HOST_POLICY_REQUIRED');
 });
 it('rejects accessor fields without invoking getters',async()=>{
   let reads=0;
   const getter=()=>{reads++;return 443};
   const p=base();Object.defineProperty(p,'minCpu',{get:getter,enumerable:true});
   await expect(inspectLanHost(p)).rejects.toThrow('EXPLICIT_HOST_POLICY_REQUIRED');
   const q=base();Object.defineProperty(q.ports,'0',{get:getter,enumerable:true});
   await expect(inspectLanHost(q)).rejects.toThrow('EXPLICIT_HOST_POLICY_REQUIRED');
   const r=base();Object.defineProperty(r.markerPaths,'database',{get:getter,enumerable:true});
   await expect(inspectLanHost(r)).rejects.toThrow('EXPLICIT_HOST_POLICY_REQUIRED');
   expect(reads).toBe(0);
 });
 it.skipIf(process.platform!=='linux')('observes missing canonical ancestors but refuses missing paths under symlinks and dangling symlinks',async()=>{
   const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-host-custody-'));
   try{
     await mkdir(join(dir,'actual'));await symlink(join(dir,'actual'),join(dir,'alias'));
     await symlink(join(dir,'missing'),join(dir,'dangling'));
     const p={...base(),targetDirectory:dir,markerPaths:{database:join(dir,'alias','missing-db'),credentials:join(dir,'dangling','missing-key'),service:join(dir,'absent','nested','svc')}};
     const pending=inspectLanHost(p);p.markerPaths.database=join(dir,'new-db');p.ports.push(8443);
     const r=await pending;
     expect(r.markers).toEqual({database:'UNKNOWN',credentials:'UNKNOWN',service:'NOT_OBSERVED'});
     expect(r.ports).toHaveLength(1);
     expect(Object.isFrozen(r.checks)).toBe(true);expect(Object.isFrozen(r.checks[0])).toBe(true);
     expect(Object.isFrozen(r.ports)).toBe(true);expect(Object.isFrozen(r.ports[0])).toBe(true);
     expect(Object.isFrozen(r.markers)).toBe(true);expect(r.installation_authorized).toBe(false);
   }finally{await rm(dir,{recursive:true,force:true})}
 });
});
