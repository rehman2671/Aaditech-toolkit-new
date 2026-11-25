import {it,expect,vi} from 'vitest';
import {inspectHazardAssessment,recordHazardAssessment} from '../../troubleshooting-hazard-assessment.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const principal={id:1,role:'SUPER_ADMIN',tenant_id:id(1)},installationId=id(2),deviceId=id(3),incidentId=id(4),requestId=id(5);
const input={principal,installationId,deviceId,incidentId,requestId,assessment:'PHYSICAL_HAZARD',confirmation:'CONFIRM_HUMAN_HAZARD_SCREENING_ONLY'};
const incident={incident_id:incidentId,installation_id:installationId,tenant_id:principal.tenant_id,device_id:deviceId,category_id:'TR-01',status:'OPEN',hazard:'UNKNOWN'};
const row={...incident,assessment_id:id(6),actor_user_id:1,request_id:requestId,assessment:'PHYSICAL_HAZARD'};
function fixture({inc=incident,prior=null,replay=[],write=1}={}){
 const c={beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),destroy:vi.fn(),query:vi.fn(async q=>{
  if(q.includes('FROM users'))return [[{id:1,role:'SUPER_ADMIN',tenant_id:principal.tenant_id,active:1,status:'ACTIVE'}]];
  if(q.includes('FROM devices'))return [[{id:deviceId}]];
  if(q.includes('FROM troubleshooting_incidents'))return [[inc]];
  if(q.includes('SELECT * FROM troubleshooting_hazard_assessments'))return [prior?[prior]:[]];
  if(q.includes('SELECT incident_id FROM troubleshooting_hazard_assessments'))return [replay];
  if(q.startsWith('INSERT'))return [{affectedRows:write}];throw Error(q);
 })};return {c,pool:{getConnection:async()=>c}}
}
it('records one immutable screening and audit, no intake change or authorization',async()=>{const f=fixture();expect(await recordHazardAssessment(f.pool,input)).toMatchObject({assessment:'PHYSICAL_HAZARD',human_referral_required:true,safety_verified:false,diagnostic_authorized:false});expect(f.c.query.mock.calls.filter(([q])=>q.startsWith('INSERT'))).toHaveLength(2);expect(f.c.query.mock.calls.every(([q])=>!q.startsWith('UPDATE'))).toBe(true);expect(f.c.commit).toHaveBeenCalledOnce()});
it('no observed hazard never asserts verified safety',async()=>{const f=fixture();expect(await recordHazardAssessment(f.pool,{...input,assessment:'NONE'})).toMatchObject({human_referral_required:false,safety_verified:false,repair_authorized:false})});
it('refuses known hazards, escalated D3, foreign scope, conflicting request and failed audit',async()=>{for(const f of [fixture({inc:{...incident,hazard:'NONE'}}),fixture({inc:{...incident,category_id:'TR-05'}}),fixture({inc:{...incident,tenant_id:id(9)}}),fixture({replay:[{incident_id:id(9)}]}),fixture({write:0})]){await expect(recordHazardAssessment(f.pool,input)).rejects.toThrow();expect(f.c.commit).not.toHaveBeenCalled()}});
it('returns exact replay and denies reassessment',async()=>{const f=fixture({prior:row});expect(await inspectHazardAssessment(f.pool,input)).toMatchObject({assessment_id:id(6)});expect(await recordHazardAssessment(f.pool,input)).toMatchObject({duplicate:true});await expect(recordHazardAssessment(f.pool,{...input,assessment:'NONE'})).rejects.toThrow('HAZARD_CONFLICT')});
