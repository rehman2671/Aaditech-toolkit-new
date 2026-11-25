import {it,expect,vi} from 'vitest';
import {createObservationIncident} from '../../troubleshooting-incidents.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const principal={id:1,tenant_id:id(1),role:'SUPER_ADMIN'},deviceId=id(2),installationId=id(3),requestId=id(4);
const input={principal,deviceId,installationId,requestId,signal:'HIGH_CPU_OBSERVATION',confirmation:'CONFIRM_OBSERVATION_REPORT_ONLY'};
const row={id:deviceId,tenant_id:principal.tenant_id,hostname:'PC',status:'ONLINE',agent_token_revoked:0,telemetry_age_seconds:10,cpu_usage:'95%',memory_usage:null,disk_free_gb:50,disk_total_gb:100};
const incident={incident_id:id(5),installation_id:installationId,tenant_id:principal.tenant_id,device_id:deviceId,actor_user_id:1,intake_request_id:requestId,category_id:'TR-01',hazard:'UNKNOWN',status:'OPEN'};
function fixture({observed=row,prior=[],audit=[{id:id(6)}]}={}){
 const c={beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),query:vi.fn(async(q)=>{
  if(q.includes('TIMESTAMPDIFF'))return [[observed]];
  if(q.includes('FROM devices'))return [[{id:deviceId,tenant_id:principal.tenant_id}]];
  if(q.includes('FROM users'))return [[{id:1,tenant_id:principal.tenant_id,role:'SUPER_ADMIN',active:1,status:'ACTIVE'}]];
  if(q.includes('FROM troubleshooting_incidents'))return [prior];
  if(q.includes('FROM audit_logs'))return [audit];
  if(q.startsWith('INSERT'))return [{affectedRows:1}];
  throw Error(q);
 })};return {c,pool:{getConnection:async()=>c}}
}
it('records current telemetry only as human-confirmed unknown-hazard intake',async()=>{const f=fixture();const r=await createObservationIncident(f.pool,input);expect(r).toMatchObject({category_id:'TR-01',status:'OPEN',diagnostic_authorized:false,measurement_truth_verified:false});expect(f.c.commit).toHaveBeenCalledOnce();expect(f.c.query.mock.calls.find(([q])=>q.startsWith('INSERT INTO troubleshooting_incidents'))[1]).toContain('UNKNOWN')});
it('rejects stale, absent, revoked and arbitrary pressure input',async()=>{for(const observed of [{...row,telemetry_age_seconds:3601},{...row,cpu_usage:null},{...row,agent_token_revoked:1}]){const f=fixture({observed});await expect(createObservationIncident(f.pool,input)).rejects.toThrow('OBSERVATION_NOT_CURRENT');expect(f.c.rollback).toHaveBeenCalledOnce()}await expect(createObservationIncident(fixture().pool,{...input,signal:'ARBITRARY'})).rejects.toThrow('INCIDENT_INVALID')});
it('exact retry requires matching observation audit, no second measurement or write',async()=>{const f=fixture({prior:[incident]});expect(await createObservationIncident(f.pool,input)).toMatchObject({duplicate:true,incident_id:incident.incident_id});expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);await expect(createObservationIncident(fixture({prior:[incident],audit:[]}).pool,input)).rejects.toThrow('OBSERVATION_REPLAY_UNVERIFIED')});
