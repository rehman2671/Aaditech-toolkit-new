import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,chmod,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseLinuxPowerProfile as profile,parseLinuxBluetoothBlock as block,collectLocalPowerDiagnostic as power,collectLocalBluetoothDiagnostic as bluetooth} from '../../scripts/local-categorical-diagnostics.mjs';
import {runLocalDiagnosticCli as cli} from '../../scripts/local-diagnostic-cli.mjs';
import {retainLocalDiagnosticArtifact as retain,readRetainedLocalDiagnosticArtifact as read} from '../../scripts/local-diagnostic-artifact-store.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),confirm='--confirm-local-read-only';
const empty={radio_state:null,service_state:null};
describe('fixed passive Linux power profile and Bluetooth block sources',()=>{
 for(const [raw,mode] of [['low-power','POWER_SAVER'],['balanced','BALANCED'],['performance','PERFORMANCE'],['quiet','OTHER'],['cool','OTHER'],['balanced-performance','OTHER'],['custom','OTHER']])
  it('maps known profile '+raw,()=>expect(profile(raw)).toEqual({power_mode:mode,sleep_policy_state:null}));
 for(const [i,raw] of [null,undefined,0,true,{},[],'','unknown','BALANCED',' balanced','balanced\n','balanced\r','power-saver','performance\0','x'.repeat(129)].entries())
  it('does not infer profile from malformed or unknown input '+i,()=>expect(profile(raw)).toEqual({power_mode:null,sleep_policy_state:null}));
 for(const soft of ['0','1'])for(const hard of ['0','1'])
  it('reports only a blocked radio '+soft+hard,()=>expect(block({type:'bluetooth',soft,hard})).toEqual({radio_state:soft==='1'||hard==='1'?'OFF':null,service_state:null}));
 for(const [i,type] of [null,undefined,true,{},[],'wlan','Bluetooth','bluetooth\n','bluetooth '].entries())
  it('never misclassifies another device type '+i,()=>expect(block({type,soft:'1',hard:'1'})).toEqual(empty));
 for(const [i,v] of [null,undefined,0,1,true,false,{},[],'','2','01','1\n',' 1','-1'].entries())
  it('requires canonical both-bit evidence '+i,()=>{
   expect(block({type:'bluetooth',soft:v,hard:'1'})).toEqual(empty);
   expect(block({type:'bluetooth',soft:'1',hard:v})).toEqual(empty);
  });
 for(const [i,radioId] of [null,undefined,1,'rfkill','rfkill-1','rfkill1\n','../rfkill0','/sys/rfkill0','rfkill0/../rfkill1','rfkill1234567','RFKILL0',' rfkill0'].entries())
  it('rejects invalid explicit radio selector '+i,async()=>await expect(bluetooth({confirmation:'COLLECT_LOCAL_BLUETOOTH_ONLY',radioId})).rejects.toThrow('EXPLICIT_LOCAL_DIAGNOSTIC_POLICY_REQUIRED'));
 it('requires local policy confirmation',async()=>{
  await expect(power()).rejects.toThrow('EXPLICIT_LOCAL_DIAGNOSTIC_POLICY_REQUIRED');
  await expect(bluetooth({radioId:'rfkill0'})).rejects.toThrow('EXPLICIT_LOCAL_DIAGNOSTIC_POLICY_REQUIRED');
 });
 it('reads real selected sources or returns unknown, never reports services or identifiers',async()=>{
  for(const [r,fields] of [[await power({confirmation:'COLLECT_LOCAL_POWER_ONLY'}),['power_mode','sleep_policy_state']],
   [await bluetooth({confirmation:'COLLECT_LOCAL_BLUETOOTH_ONLY',radioId:'rfkill0'}),['radio_state','service_state']]]){
   const doc=JSON.parse(r.artifact);
   expect(Object.keys(doc)).toEqual(['schema',...fields]);expect(doc[fields[1]]).toBeNull();
   expect(r.artifact_sha256).toBe(sha(r.artifact));expect(r.measured_fields).toBe(doc[fields[0]]===null?0:1);
   expect(r).toMatchObject({measurement_truth_verified:false,remote_execution_authorized:false,production_accepted:false});
   expect(r.artifact.toString()).not.toContain('rfkill0');
  }
 });
 it('does not confuse missing device with a powered off or healthy radio',async()=>{
  const r=await cli(['bluetooth','--radio','rfkill999999',confirm]);
  expect(r.artifact).toEqual({schema:'aaditech-bluetooth-diagnostic-v1',...empty});expect(r.measured_fields).toBe(0);
 });
 it('refuses extra selectors or missing CLI consent',async()=>{
  for(const args of [['power'],['power','--target','/tmp',confirm],['power',confirm,confirm],
   ['bluetooth','--radio','rfkill0'],['bluetooth',confirm],['bluetooth','--radio','rfkill0','--radio','rfkill1',confirm]])
   await expect(cli(args)).rejects.toThrow();
 });
 it.skipIf(process.platform==='win32')('retains only locally observable canonical fields',async()=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'itk-power-bt-'));
  try{
   await chmod(directory,0o700);
   for(const r of [await power({confirmation:'COLLECT_LOCAL_POWER_ONLY'}),await bluetooth({confirmation:'COLLECT_LOCAL_BLUETOOTH_ONLY',radioId:'rfkill999999'})]){
    const args={confirmation:'RETAIN_LOCAL_DIAGNOSTIC_ONLY',directory,artifact:r.artifact,expectedArtifactSha256:r.artifact_sha256};
    expect(await retain(args)).toMatchObject({artifact_retained:true,attempt_accepted:false});
    expect((await read({confirmation:'READ_LOCAL_DIAGNOSTIC_ONLY',directory,expectedArtifactSha256:r.artifact_sha256})).artifact).toEqual(r.artifact);
   }
   for(const doc of [{schema:'aaditech-power-diagnostic-v1',power_mode:'BALANCED',sleep_policy_state:'CONFIGURED'},
     {schema:'aaditech-bluetooth-diagnostic-v1',radio_state:'ON',service_state:null},
     {schema:'aaditech-bluetooth-diagnostic-v1',radio_state:'OFF',service_state:'RUNNING'},
     {schema:'aaditech-bluetooth-diagnostic-v1',radio_state:'OFF',service_state:null,name:'private'}]){
    const artifact=Buffer.from(JSON.stringify(doc));
    await expect(retain({confirmation:'RETAIN_LOCAL_DIAGNOSTIC_ONLY',directory,artifact,expectedArtifactSha256:sha(artifact)})).rejects.toThrow('LOCAL_ARTIFACT_INVALID');
   }
   expect(await readdir(directory)).toHaveLength(2);
  }finally{await rm(directory,{recursive:true,force:true})}
 });
});
