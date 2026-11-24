import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {normalizeLinuxBattery,collectLocalBatteryDiagnostic} from '../../scripts/local-battery-diagnostic.mjs';
const states=[['Charging','CHARGING'],['Discharging','DISCHARGING'],['Full','FULL'],['Not charging','NOT_CHARGING'],['Unknown',null],[null,null]];
const levels=[['0',0],['1',1],['50',50],['100',100],['101',null],['-1',null],['01',null],['1.0',null],['50\n',null],[50,null],[true,null],[null,null]];
describe('Linux local battery normalization',()=>{
 for(const [status,state] of states)for(const [capacity,charge] of levels){
  it('status '+String(status)+' / capacity '+JSON.stringify(capacity),()=>{
   expect(normalizeLinuxBattery({capacity,status})).toEqual({schema:'aaditech-battery-diagnostic-v1',charge_percent:charge,charging_state:state,capacity_percent:null});
  });
 }
 it('requires local explicit confirmation',async()=>expect(collectLocalBatteryDiagnostic()).rejects.toThrow('EXPLICIT_LOCAL_BATTERY_POLICY_REQUIRED'));
 it('reads actual local kernel observations without identifiers or wear claims',async()=>{
  const r=await collectLocalBatteryDiagnostic({confirmation:'COLLECT_LOCAL_BATTERY_ONLY'}),doc=JSON.parse(r.artifact);
  expect(Object.keys(doc)).toEqual(['schema','charge_percent','charging_state','capacity_percent']);
  expect(doc.capacity_percent).toBeNull();expect(r.measured_fields).toBe([doc.charge_percent,doc.charging_state].filter(x=>x!==null).length);
  expect(r.artifact_sha256).toBe(createHash('sha256').update(r.artifact).digest('hex'));
  expect(r).toMatchObject({measurement_truth_verified:false,remote_execution_authorized:false,production_accepted:false});
 });
});
