import { describe, it, expect, vi } from 'vitest';
import { analyzeMeasuredTelemetry, deviceMetricView, evaluateMeasuredAlert } from '../../device-metrics.js';
import { scopedAlertRules, deliverTenantWebhook } from '../../tenant-alert-safety.js';
import { deliverTenantEmail } from '../../smtp-alerts.js';
import { destinationFingerprint, matchesQueuedDestination } from '../../notification-destination.js';
import { deliverOutboxEntry } from '../../notification-outbox.js';
import { readFileSync } from 'node:fs';

const metrics=['cpu','ram','disk'];
const invalidThresholds=[null,undefined,true,false,{},[],NaN,Infinity,-Infinity,-1,'',' ','0x10','1e1','10\n','-1'];
const invalidMeasurements=[null,undefined,true,false,{},[],'10',NaN,Infinity,-Infinity,-1];
const invalidConsent=[false,0,1,'0','1','false','true','',null,undefined,[],{}];
const invalidAcknowledgments=[false,0,1,'true','false',null,undefined,{},[]];
const tenant='tenant-A';
const webhook={enabled:true,url:'https://hooks.slack.com/services/test',type:'slack'};
const email={enabled:true,recipient:'alerts@example.com'};
const env={HMAC_SECRET:'fixture-only-operator-key-long',WEBHOOK_ALLOWED_HOSTS:'hooks.slack.com',
 SMTP_HOST:'smtp.example.com',SMTP_SECURITY:'starttls',SMTP_PORT:'587',SMTP_USER:'ci',SMTP_PASSWORD:'fixture-only',
 SMTP_FROM:'alerts@example.com',SMTP_ALLOWED_RECIPIENT_DOMAINS:'example.com',SMTP_TIMEOUT_MS:'12000'};
const event={title:'Disk warning',message:'Capacity',severity:'warning'};
const row=channel=>({id:1,tenant_id:tenant,channel,payload_json:JSON.stringify(event)});
const adapters=(config,result)=>({getEmailConfig:async()=>config,getWebhookConfig:async()=>config,
 verifyDestination:()=>true,sendEmail:vi.fn(async()=>result),sendWebhook:vi.fn(async()=>result)});

describe('Measured alert numeric admission matrix',()=>{
 for(const metric of metrics){
  for(const [i,value] of invalidThresholds.entries())
   it(metric+' rejects invalid threshold '+i,()=>expect(evaluateMeasuredAlert({metric,threshold:value},{[metric]:50})).toBeNull());
  for(const [i,value] of invalidMeasurements.entries())
   it(metric+' rejects invalid measurement '+i,()=>expect(evaluateMeasuredAlert({metric,threshold:50},{[metric]:value})).toBeNull());
  it(metric+' rejects out-of-range measurement and threshold',()=>{
   const tooHigh=metric==='disk'?1000001:101;
   expect(evaluateMeasuredAlert({metric,threshold:50},{[metric]:tooHigh})).toBeNull();
   expect(evaluateMeasuredAlert({metric,threshold:tooHigh},{[metric]:50})).toBeNull();
  });
  it(metric+' admits an exact numeric boundary',()=>expect(evaluateMeasuredAlert({metric,threshold:50},{[metric]:50})).toEqual(expect.any(String)));
  it(metric+' admits SQL decimal boundary and rejects non-trigger',()=>{
   expect(evaluateMeasuredAlert({metric,threshold:'50.00'},{[metric]:50})).toEqual(expect.any(String));
   expect(evaluateMeasuredAlert({metric,threshold:50},{[metric]:metric==='disk'?51:49})).toBeNull();
  });
 }
});

describe('Tenant consent and delivery evidence matrix',()=>{
 for(const [i,enabled] of invalidConsent.entries())
  it('rejects non-explicit channel consent '+i,async()=>{
   const hook={...webhook,enabled},mail={...email,enabled};
   const send=vi.fn(async()=>({accepted:true,ok:true,status:204}));
   expect(destinationFingerprint(tenant,'webhook',hook,env)).toBeNull();
   expect(destinationFingerprint(tenant,'email',mail,env)).toBeNull();
   expect((await deliverTenantWebhook(tenant,hook,event,send,'hooks.slack.com')).dispatched).toBe(false);
   expect((await deliverTenantEmail(tenant,mail,event,send,env)).accepted).toBe(false);
   for(const [channel,config] of [['email',mail],['webhook',hook]]){
    const a=adapters(config,{accepted:true,dispatched:true});
    expect(await deliverOutboxEntry(row(channel),a)).toMatchObject({outcome:'SKIPPED',reason:'DISABLED'});
    expect(a.sendEmail).not.toHaveBeenCalled();expect(a.sendWebhook).not.toHaveBeenCalled();
   }
   expect(send).not.toHaveBeenCalled();
  });
 for(const [i,enabled] of invalidConsent.filter(v=>v!==1).entries())
  it('excludes ambiguous rule enabled value '+i,()=>expect(scopedAlertRules(tenant,[{tenant_id:tenant,enabled}])).toEqual([]));
 it('retains explicit boolean and SQL integer rule enablement, without tenant coercion',()=>{
  const a={tenant_id:tenant,enabled:true},b={tenant_id:tenant,enabled:1};
  expect(scopedAlertRules(tenant,[a,b,{tenant_id:{toString:()=>tenant},enabled:true},{tenant_id:'tenant-B',enabled:true}])).toEqual([a,b]);
 });
 for(const channel of ['email','webhook']){
  const config=channel==='email'?email:webhook,field=channel==='email'?'accepted':'dispatched';
  for(const [i,value] of invalidAcknowledgments.entries())
   it(channel+' cannot fabricate delivery from acknowledgment '+i,async()=>{
    const a=adapters(config,{[field]:value});
    expect(await deliverOutboxEntry(row(channel),a)).toMatchObject({outcome:'RETRY'});
   });
  it(channel+' rejects ambiguous destination verifier response',async()=>{
   const a=adapters(config,{[field]:true});a.verifyDestination=()=> 'true';
   expect(await deliverOutboxEntry(row(channel),a)).toMatchObject({outcome:'SKIPPED',reason:'DESTINATION_CHANGED_OR_UNBOUND'});
   expect(a.sendEmail).not.toHaveBeenCalled();expect(a.sendWebhook).not.toHaveBeenCalled();
  });
  it(channel+' accepts explicit acknowledgment only after binding',async()=>{
   expect(await deliverOutboxEntry(row(channel),adapters(config,{[field]:true}))).toEqual({outcome:'DELIVERED'});
  });
 }
 for(const [i,response] of [{ok:true,status:199},{ok:true,status:300},{ok:true,status:500},{ok:'true',status:204},{ok:true,status:'204'},{ok:true},null].entries())
  it('refuses invalid webhook response '+i,async()=>expect((await deliverTenantWebhook(tenant,webhook,event,async()=>response,'hooks.slack.com')).dispatched).toBe(false));
 it('accepts actual HTTP 204 response',async()=>expect(await deliverTenantWebhook(tenant,webhook,event,async()=>({ok:true,status:204}),'hooks.slack.com')).toEqual({dispatched:true,status_code:204}));
 it('does not coerce fingerprint objects or accept a trailing newline',()=>{
  const digest=destinationFingerprint(tenant,'webhook',webhook,env);
  expect(matchesQueuedDestination({...row('webhook'),destination_hash:digest},webhook,env)).toBe(true);
  for(const invalid of [digest+'\n',{toString:()=>digest},Buffer.from(digest)])
   expect(matchesQueuedDestination({...row('webhook'),destination_hash:invalid},webhook,env)).toBe(false);
 });
});

describe('Predictive evidence continuity and honest reporting',()=>{
 const now=Date.parse('2026-11-25T00:00:00Z');
 const device={hostname:'PC-1',telemetry_reported_at:new Date(now-60000),disk_free:'100 GB',cpu_usage:'20%',memory_usage:'50%'};
 const history=(minutes=[65,49,33,17,1],values=[110,108,106,103,100])=>minutes.map((n,i)=>({recorded_at:new Date(now-n*60000),disk_free_gb:values[i]}));
 it('keeps a continuous matching trend',()=>expect(analyzeMeasuredTelemetry(history(),device,now).status).toBe('ANALYZED'));
 it('refuses a long gap between observations',()=>expect(analyzeMeasuredTelemetry(history([130,49,33,17,1]),device,now)).toMatchObject({status:'INSUFFICIENT_DATA',forecast_blocker:'OBSERVATION_GAP',projected_days_until_full:null}));
 it('refuses conflicting current disk snapshot',()=>expect(analyzeMeasuredTelemetry(history(),{...device,disk_free:'200 GB'},now)).toMatchObject({forecast_blocker:'SNAPSHOT_MISMATCH',projected_days_until_full:null}));
 it('refuses excessive timestamp skew between otherwise fresh snapshots',()=>expect(analyzeMeasuredTelemetry(history(),{...device,telemetry_reported_at:new Date(now-12*60000)},now)).toMatchObject({forecast_blocker:'SNAPSHOT_MISMATCH',projected_days_until_full:null}));
 it('allows FLOAT storage rounding at matching snapshot',()=>expect(analyzeMeasuredTelemetry(history(undefined,[110,108,106,103,100.0005]),device,now).status).toBe('ANALYZED'));
 it('does not parse untyped timestamp objects or an infinite evaluation clock',()=>{
  expect(deviceMetricView({...device,telemetry_reported_at:{valueOf:()=>now}},now).telemetry_status).toBe('UNVERIFIED');
  expect(deviceMetricView(device,Infinity).cpu_usage).toBeNull();
 });
 it('preserves measured zero remaining for a valid depletion trend',()=>expect(analyzeMeasuredTelemetry(history(undefined,[10,8,6,3,0]),{...device,disk_free:'0 GB'},now).projected_days_until_full).toBe(0));
 it('counts zero-day risk and does not describe absent evidence as healthy in the daily brief',()=>{
  const api=readFileSync(new URL('../../server.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../Enterprise/portal/index.html',import.meta.url),'utf8');
  expect(api).toContain('Number.isFinite(a.projected_days_until_full) && a.projected_days_until_full >= 0');
  expect(ui).toContain('No open alerts returned; this does not establish fleet health.');
  expect(ui).toContain('No predictive evidence available.');
  expect(ui).not.toContain('Zero open alerts. All fleet parameters healthy.');
 });
});
