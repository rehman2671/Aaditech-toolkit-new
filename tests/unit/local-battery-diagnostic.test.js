import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,chmod,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseBatteryObservations as parse,collectLocalBatteryDiagnostic as collect} from '../../scripts/local-categorical-diagnostics.mjs';
import {runLocalDiagnosticCli as cli} from '../../scripts/local-diagnostic-cli.mjs';
import {retainLocalDiagnosticArtifact as retain,readRetainedLocalDiagnosticArtifact as read} from '../../scripts/local-diagnostic-artifact-store.mjs';
const base={type:'Battery',present:'1',charge:'50',status:'Charging',energyFull:'800',energyDesign:'1000'};
const sha=b=>createHash('sha256').update(b).digest('hex');
const empty={charge_percent:null,charging_state:null,capacity_percent:null};
describe('Linux passive battery observation',()=>{
 it('reports percentages and categorical status without identifiers',()=>expect(parse(base)).toEqual({charge_percent:50,charging_state:'CHARGING',capacity_percent:80}));
 for(const [i,v] of [null,undefined,0,50,true,{},[],'-1','101','01','1e1','0x10','50\n',' 50','50.1','9'.repeat(19)].entries())
  it('rejects invalid charge observation '+i,()=>expect(parse({...base,charge:v}).charge_percent).toBeNull());
 for(const [raw,status] of [['Charging','CHARGING'],['Discharging','DISCHARGING'],['Full','FULL'],['Not charging','NOT_CHARGING'],['Unknown',null],['Charging\n',null],[true,null],[null,null]])
  it('maps status '+String(raw),()=>expect(parse({...base,status:raw}).charging_state).toBe(status));
 for(const [i,v] of [null,undefined,0,'0','-1','799','01','1e3','1000\n','9'.repeat(19)].entries())
  it('refuses invalid design capacity '+i,()=>expect(parse({...base,energyDesign:v}).capacity_percent).toBeNull());
 for(const [i,v] of [null,undefined,'0',0,true,'1001','-1','0800','800\n','8e2'].entries())
  it('checks full capacity '+i,()=>expect(parse({...base,energyFull:v}).capacity_percent).toBe(v==='0'?0:null));
 it('uses charge units only if both energy fields absent',()=>{
  expect(parse({...base,energyFull:null,energyDesign:null,chargeFull:'600',chargeDesign:'1000'}).capacity_percent).toBe(60);
  expect(parse({...base,energyDesign:null,chargeFull:'600',chargeDesign:'1000'}).capacity_percent).toBeNull();
 });
 it('preserves actual zero and 100 percent',()=>{
  expect(parse({...base,charge:'0'}).charge_percent).toBe(0);
  expect(parse({...base,charge:'100'}).charge_percent).toBe(100);
 });
 for(const [i,v] of [null,'0',0,1,true,'1\n','01'].entries())
  it('requires explicitly present battery '+i,()=>expect(parse({...base,present:v})).toEqual(empty));
 for(const [i,v] of ['Mains','UPS','battery',null,{},'Battery\n'].entries())
  it('requires battery type '+i,()=>expect(parse({...base,type:v})).toEqual(empty));
 for(const [i,id] of [undefined,null,1,'BAT','BAT-1','BAT0\n','../BAT0','/sys/BAT0','BAT0/../BAT1','BAT1234567','bat0',' BAT0'].entries())
  it('rejects invalid battery selector '+i,async()=>await expect(collect({confirmation:'COLLECT_LOCAL_BATTERY_ONLY',batteryId:id})).rejects.toThrow('EXPLICIT_LOCAL_DIAGNOSTIC_POLICY_REQUIRED'));
 it('requires explicit local confirmation',async()=>await expect(collect({batteryId:'BAT0'})).rejects.toThrow());
 it('reads fixed system source or reports unavailable without inventing values',async()=>{
  const r=await collect({confirmation:'COLLECT_LOCAL_BATTERY_ONLY',batteryId:'BAT0'});
  const doc=JSON.parse(r.artifact);
  expect(Object.keys(doc)).toEqual(['schema','charge_percent','charging_state','capacity_percent']);
  expect(r.artifact_sha256).toBe(sha(r.artifact));
  expect(r.measured_fields).toBe(Object.values(doc).slice(1).filter(v=>v!==null).length);
  expect(r).toMatchObject({measurement_truth_verified:false,remote_execution_authorized:false,production_accepted:false});
  expect(r.artifact.toString()).not.toContain('BAT0');
 });
 it('does not confuse absence with zero or a healthy battery',async()=>{
  const r=await cli(['battery','--battery','BAT999999','--confirm-local-read-only']);
  expect(r.artifact).toEqual({schema:'aaditech-battery-diagnostic-v1',...empty});
  expect(r.measured_fields).toBe(0);
 });
 it('rejects extra selectors and missing confirmation through CLI',async()=>{
  for(const args of [['battery','--battery','BAT0'],['battery','--battery','BAT0','--target','/tmp','--confirm-local-read-only'],['battery','--battery','BAT0','--battery','BAT1','--confirm-local-read-only']])
   await expect(cli(args)).rejects.toThrow();
 });
 it.skipIf(process.platform==='win32')('retains canonical battery bytes and rejects private fields',async()=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'itk-battery-'));
  try{
   await chmod(directory,0o700);
   const result=await collect({confirmation:'COLLECT_LOCAL_BATTERY_ONLY',batteryId:'BAT0'});
   const args={confirmation:'RETAIN_LOCAL_DIAGNOSTIC_ONLY',directory,artifact:result.artifact,expectedArtifactSha256:result.artifact_sha256};
   expect(await retain(args)).toMatchObject({artifact_retained:true,attempt_accepted:false});
   expect((await read({confirmation:'READ_LOCAL_DIAGNOSTIC_ONLY',directory,expectedArtifactSha256:result.artifact_sha256})).artifact).toEqual(result.artifact);
   const invalid=Buffer.from(JSON.stringify({...JSON.parse(result.artifact),serial:'private'}));
   await expect(retain({...args,artifact:invalid,expectedArtifactSha256:sha(invalid)})).rejects.toThrow('LOCAL_ARTIFACT_INVALID');
   expect(await readdir(directory)).toHaveLength(1);
  }finally{await rm(directory,{recursive:true,force:true})}
 });
});
