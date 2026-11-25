import {afterEach,expect,it,vi} from 'vitest';
import * as db from '../../db.js';
import {runNotificationOutboxBatch} from '../../notification-outbox.js';
const mode=process.env.NODE_ENV;
afterEach(()=>{db.setConnectionStateForTesting(false,null);if(mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=mode});
const row={id:7,tenant_id:'tenant-A',lease_token:'12345678-1234-4123-8123-123456789abc',attempts:1,channel:'email',payload_json:{title:'fixture'}};
const adapters=()=>({claim:vi.fn(async()=>[row]),complete:vi.fn(async()=>true),retry:vi.fn(async()=>true),renewLease:vi.fn(async()=>true),getEmailConfig:vi.fn(async()=>({enabled:true})),verifyDestination:()=>true,sendEmail:vi.fn(async()=>({accepted:true}))});
it('renew SQL is bound to the exact live claim and DB clock',async()=>{
 process.env.NODE_ENV='production';const query=vi.fn(async()=>[{affectedRows:1}]);
 db.setConnectionStateForTesting(true,{query});expect(await db.renewNotificationOutboxLease(row)).toBe(true);
 const [sql,params]=query.mock.calls[0];expect(params).toEqual([row.id,row.tenant_id,row.lease_token,1,'email']);
 for(const clause of ['tenant_id = ?','lease_token = ?','attempts = ?','channel = ?',"status = 'PROCESSING'",'lease_expires_at > UTC_TIMESTAMP(3)','INTERVAL 300 SECOND'])expect(sql).toContain(clause);
});
it('renew refuses offline SQL and cannot fabricate a lease',async()=>{process.env.NODE_ENV='production';db.setConnectionStateForTesting(false,null);await expect(db.renewNotificationOutboxLease(row)).rejects.toThrow('OUTBOX_DATABASE_UNAVAILABLE')});
for(const value of [false,null])it('does not send or acknowledge lost or unknown lease '+value,async()=>{
 const a=adapters();a.renewLease.mockResolvedValue(value);
 if(value===null)await expect(runNotificationOutboxBatch(a)).rejects.toThrow('OUTBOX_BATCH_UNCONFIRMED');
 else expect(await runNotificationOutboxBatch(a)).toMatchObject({processed:1,lostLease:1});
 expect(a.sendEmail).not.toHaveBeenCalled();expect(a.complete).not.toHaveBeenCalled();expect(a.retry).not.toHaveBeenCalled();
});
it('renews after configuration lookup and before external dispatch',async()=>{
 const a=adapters(),events=[];a.getEmailConfig.mockImplementation(async()=>{events.push('config');return {enabled:true}});
 a.renewLease.mockImplementation(async()=>{events.push('renew');return true});a.sendEmail.mockImplementation(async()=>{events.push('send');return {accepted:true}});
 a.complete.mockImplementation(async()=>{events.push('complete');return true});expect(await runNotificationOutboxBatch(a)).toMatchObject({delivered:1});expect(events).toEqual(['config','renew','send','complete']);
});
it('stopping during renewal leaves claim for expiry, no external call',async()=>{const a=adapters();let running=true;a.canStart=()=>running;a.renewLease.mockImplementation(async()=>{running=false;return true});expect(await runNotificationOutboxBatch(a)).toMatchObject({processed:0});expect(a.sendEmail).not.toHaveBeenCalled();expect(a.complete).not.toHaveBeenCalled();expect(a.retry).not.toHaveBeenCalled()});
it('stopping before claim prevents queue mutation',async()=>{const a=adapters();a.canStart=()=>false;await runNotificationOutboxBatch(a);expect(a.claim).not.toHaveBeenCalled()});
it('production legacy telemetry record and offline direct batch refuse acceptance',async()=>{process.env.NODE_ENV='production';db.setConnectionStateForTesting(false,null);await expect(db.insertTelemetryRecord('device-A',{cpu_pct:1})).rejects.toThrow('TELEMETRY_KEYED_BATCH_REQUIRED');await expect(db.insertTelemetryBatch([{device_id:'device-A',cpu_pct:1}])).rejects.toThrow('TELEMETRY_DATABASE_UNAVAILABLE')});
it('direct production batch refuses mismatched insert count',async()=>{process.env.NODE_ENV='production';db.setConnectionStateForTesting(true,{query:async()=>[{affectedRows:0}]});await expect(db.insertTelemetryBatch([{device_id:'device-A',cpu_pct:1}])).rejects.toThrow('TELEMETRY_INSERT_UNCONFIRMED')});
