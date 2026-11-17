#!/usr/bin/env node
// Stage N29: disposable GitHub Actions MySQL ONLY; no customer tenants.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import request from 'supertest';
import * as db from './db.js';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.AADITECH_ATOMIC_BATCH_REHEARSAL !== 'isolated-ci' ||
    process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'it_toolkit') {
  throw new Error('Refusing telemetry transaction rehearsal outside isolated CI MySQL');
}
process.env.VITEST = 'true'; // avoid server listener and retention scheduler
const { app } = await import('./server.js');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  connectionLimit: 20
});
const tenantA=crypto.randomUUID(), tenantB=crypto.randomUUID();
const devA='N29-'+crypto.randomBytes(8).toString('hex');
const devB='N29-'+crypto.randomBytes(8).toString('hex');
const hostA='N29-HTTP-'+crypto.randomBytes(5).toString('hex');
const token='itk_dev_'+crypto.randomBytes(24).toString('hex');
const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
const key='n29-'+crypto.randomBytes(8).toString('hex');
const eventKey='q-'+crypto.randomBytes(8).toString('hex')+':1';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
let failure=null;
const single=async(sql,params=[])=>{
  const [rows]=await pool.query(sql,params);
  return Number(rows[0].n);
};
const countHistory=()=>single('SELECT COUNT(*) AS n FROM telemetry_history WHERE device_id=?',[devA]);
const countAlerts=()=>single('SELECT COUNT(*) AS n FROM alerts WHERE tenant_id=? AND device_id=?',[tenantA,devA]);
const countReceipt=batch=>single('SELECT COUNT(*) AS n FROM telemetry_batches WHERE tenant_id=? AND device_id=? AND batch_id=?',[tenantA,devA,batch]);
try {
  console.log('N29: migrating disposable MySQL');
  await db.attemptConnection();
  const [cols]=await pool.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='telemetry_batches'");
  assert.equal(cols.length,1,'migration 014 receipt table');
  await pool.query(
    "INSERT INTO devices (id,tenant_id,hostname,device_uid,device_token_hash,agent_token_revoked,status) VALUES (?,?,?,?,?,0,'registered')",
    [devA,tenantA,hostA,'n29-'+devA,tokenHash]
  );
  await pool.query(
    "INSERT INTO devices (id,tenant_id,hostname,device_uid,agent_token_revoked,status) VALUES (?,?,?,?,0,'registered')",
    [devB,tenantB,'N29-SECOND','n29-'+devB]
  );
  const notification={title:'Atomic sample',message:'Measured CPU high',severity:'warning'};
  const plan={tenant_id:tenantA,device_id:devA,hostname:hostA,
    rule:'n29-direct',message:'Measured CPU high',severity:'warning',
    notifications:[{channel:'webhook',destination_hash:'a'.repeat(64),event:notification}]};
  const base={tenant_id:tenantA,device_id:devA,hostname:hostA,batch_id:key,
    request_hash:sha(JSON.stringify({device:devA,key})),
    device_updates:{status:'online',cpu_usage:'90.0%',telemetry_reported_at:new Date()},
    metrics:{cpu:90,ram:22,disk:0,latency:null},
    events:[{kind:'n29_health',payload:{disk:0},client_msg_id:eventKey}],
    alerts:[plan]};
  console.log('N29: 16 concurrent atomic transactions');
  const results=await Promise.all(Array.from({length:16},()=>db.ingestTelemetryBatchOnce(base)));
  assert.equal(results.filter(x=>!x.duplicate).length,1,'single transactional winner');
  assert.equal(results.filter(x=>x.duplicate).length,15,'15 original durable ACKs');
  assert.equal(await countReceipt(key),1,'one immutable receipt');
  assert.equal(await countHistory(),1,'one measured history row');
  assert.equal(await countAlerts(),1,'one alert');
  assert.equal(await single('SELECT COUNT(*) AS n FROM events WHERE tenant_id=? AND device_id=? AND client_msg_id=?',[tenantA,devA,eventKey]),1,'one event');
  assert.equal(await single(
    'SELECT COUNT(*) AS n FROM notification_outbox o JOIN alerts a ON a.id=o.alert_id WHERE a.tenant_id=? AND a.device_id=?',
    [tenantA,devA]),1,'one queued webhook job');
  await assert.rejects(()=>db.ingestTelemetryBatchOnce({...base,request_hash:sha('different')}),
    /TELEMETRY_BATCH_ID_CONFLICT/,'changed content with same ID fails 409-class conflict');
  assert.equal(await countHistory(),1,'conflict leaves history intact');

  const brokenKey=key+'-rollback';
  const broken={...base,batch_id:brokenKey,
    request_hash:sha('rollback-test'),events:[],
    alerts:[{...plan,notifications:[{channel:'email',destination_hash:'bad',event:notification}]}]};
  await assert.rejects(()=>db.ingestTelemetryBatchOnce(broken),/INVALID_NOTIFICATION_CHANNEL/,
    'failed notification job rolls back receipt, history and alert');
  assert.equal(await countReceipt(brokenKey),0,'failed transaction never consumes batch ID');
  assert.equal(await countHistory(),1,'no ghost history after failure');
  assert.equal(await countAlerts(),1,'no ghost alert after failure');
  const recovered=await db.ingestTelemetryBatchOnce({...broken,alerts:[]});
  assert.equal(recovered.duplicate,false,'same batch ID accepted after rollback');
  assert.equal(await countHistory(),2,'recovered batch adds one sample');

  await assert.rejects(
    ()=>db.ingestTelemetryBatchOnce({...base,tenant_id:tenantA,device_id:devB,batch_id:key+'-cross'}),
    /TELEMETRY_DEVICE_OWNER_MISMATCH/,'enrolled tenant ownership cannot be forged');

  await db.createAlertRule({id:'n29-'+crypto.randomBytes(8).toString('hex'),
    tenant_id:tenantA,name:'N29 Measured CPU',metric:'cpu',threshold:70,severity:'warning',enabled:true});
  const httpId='http-'+crypto.randomBytes(10).toString('hex');
  const body={hostname:hostA,batch_id:httpId,
    metrics:{cpu:{utilization_pct:92},ram:{utilization_pct:55},disk:{free_gb:0}},
    events:[{kind:'n29_http',client_msg_id:'http-event-'+httpId,payload:{free:0}}]};
  const post=b=>request(app).post('/api/v1/ingest/telemetry')
    .set('X-Device-Token',token).send(b).timeout({response:10000,deadline:15000});
  const beforeHistory=await countHistory(),beforeAlerts=await countAlerts();
  const first=await post(body);
  assert.equal(first.status,200,'first HTTP keyed batch');
  assert.equal(first.body.accepted,1);
  assert.equal(first.body.duplicate,false);
  assert.equal(first.body.batch_id,httpId);
  const retry=await post(body);
  assert.equal(retry.status,200,'HTTP replay succeeds');
  assert.equal(retry.body.duplicate,true,'HTTP replay is read-only');
  assert.equal(retry.body.recorded_at,first.body.recorded_at,'retry preserves original server evidence time');
  assert.equal(await countHistory(),beforeHistory+1,'one HTTP telemetry history row');
  assert.equal(await countAlerts(),beforeAlerts+1,'one HTTP alert, not two');
  assert.equal(await single('SELECT COUNT(*) AS n FROM events WHERE device_id=? AND client_msg_id=?',
    [devA,'http-event-'+httpId]),1,'one HTTP event');
  const changed=await post({...body,metrics:{cpu:{utilization_pct:41}}});
  assert.equal(changed.status,409,'same batch key changed body is HTTP conflict');
  assert.equal(changed.body.error,'TELEMETRY_BATCH_ID_CONFLICT');
  const bad=await post({...body,batch_id:'invalid batch id'});
  assert.equal(bad.status,400,'malformed batch key rejected');

  const parallelId='p-'+crypto.randomBytes(8).toString('hex');
  const parallel={hostname:hostA,batch_id:parallelId,metrics:{cpu:{utilization_pct:91}}};
  const together=await Promise.all(Array.from({length:8},()=>post(parallel)));
  assert(together.every(x=>x.status===200),'8 simultaneous HTTP ACKs');
  assert.equal(together.filter(x=>!x.body.duplicate).length,1,'one HTTP winner');
  assert.equal(together.filter(x=>x.body.duplicate).length,7,'seven HTTP retries');
  console.log('N29 PASS: atomic rollback, MySQL worker races, single history/alert/outbox, HTTP replay and 409');
} catch(err) {
  failure=err;
  console.error('N29 FAIL:',err);
} finally {
  // Only random CI records are affected. Cleanup never touches real tenants.
  try {
    await pool.query('DELETE o FROM notification_outbox o INNER JOIN alerts a ON o.alert_id=a.id WHERE a.tenant_id=?',[tenantA]);
    await pool.query('DELETE FROM alerts WHERE tenant_id=?',[tenantA]);
    await pool.query('DELETE FROM alert_rules WHERE tenant_id=?',[tenantA]);
    await pool.query('DELETE FROM telemetry_history WHERE device_id IN (?,?)',[devA,devB]);
    await pool.query('DELETE FROM events WHERE tenant_id IN (?,?)',[tenantA,tenantB]);
    await pool.query('DELETE FROM telemetry_batches WHERE tenant_id IN (?,?)',[tenantA,tenantB]);
    await pool.query('DELETE FROM devices WHERE id IN (?,?)',[devA,devB]);
  } catch(err) { console.error('N29 test cleanup:',err.message);failure ||= err; }
  await pool.end();
  db.stopDbHealthCheck();
  db.stopTelemetryFlushWorker?.();
}
process.exit(failure ? 1 : 0);
