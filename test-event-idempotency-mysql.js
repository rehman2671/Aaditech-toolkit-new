#!/usr/bin/env node
// N28: disposable CI MySQL only. NEVER run against customer data.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import * as db from './db.js';
import request from 'supertest';
if(process.env.GITHUB_ACTIONS!=='true' ||
   process.env.AADITECH_EVENT_DEDUP_REHEARSAL!=='isolated-ci' ||
   process.env.NODE_ENV!=='test' || process.env.DB_NAME!=='it_toolkit'){
  throw Error('Refusing event retry rehearsal outside isolated GitHub Actions MySQL');
}
// Import the Express app *without* launching a real listener or retention
// scheduler. The default server module auto-listens whenever VITEST is unset;
// supertest owns each ephemeral test listener instead.
process.env.VITEST='true';
const { app } = await import('./server.js');
const pool=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,
  connectionLimit:10
});
const tenantA=crypto.randomUUID(),tenantB=crypto.randomUUID();
const deviceA='N28-'+crypto.randomBytes(5).toString('hex');
const deviceB='N28-'+crypto.randomBytes(5).toString('hex');
const msgId='q-'+crypto.randomBytes(8).toString('hex')+':17';
const ev={tenant_id:tenantA,device_id:deviceA,hostname:'SHARED-PC',
  kind:'health',sanitized:true,payload:{disk_free_gb:0},client_msg_id:msgId};
async function count(t,d){
  const [r]=await pool.query('SELECT COUNT(*) AS n FROM events WHERE tenant_id = ? AND device_id = ? AND client_msg_id = ?',[t,d,msgId]);
  return Number(r[0].n);
}
try{
  await db.attemptConnection();
  const [columns]=await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME IN ('client_msg_id','event_hash')");
  assert.equal(columns.length,2,'real migration 013 columns');
  const results=await Promise.all(Array.from({length:24},()=>db.addEvent({...ev})));
  assert.equal(await count(tenantA,deviceA),1,'24 simultaneous retries create 1 row');
  assert.equal(results.filter(x=>!x.duplicate).length,1,'one insert winner');
  assert.equal(results.filter(x=>x.duplicate).length,23,'23 exact replay ACKs');
  await assert.rejects(()=>db.addEvent({...ev,payload:{disk_free_gb:999}}),/EVENT_IDEMPOTENCY_CONFLICT/);
  assert.equal(await count(tenantA,deviceA),1,'conflict cannot mutate original');
  assert.equal((await db.addEvent({...ev,tenant_id:tenantB})).duplicate,false);
  assert.equal((await db.addEvent({...ev,device_id:deviceB})).duplicate,false);
  assert.equal(await count(tenantB,deviceA),1,'other tenant same key is independent');
  assert.equal(await count(tenantA,deviceB),1,'other device same key is independent');
  const legacy={...ev,client_msg_id:undefined};
  await db.addEvent(legacy);
  await db.addEvent(legacy);
  const [unkeyed]=await pool.query('SELECT COUNT(*) AS n FROM events WHERE tenant_id = ? AND device_id = ? AND client_msg_id IS NULL',[tenantA,deviceA]);
  assert.equal(Number(unkeyed[0].n),2,'legacy unkeyed events still append');
  await assert.rejects(()=>db.addEvent({...ev,client_msg_id:'invalid key'}),/EVENT_CLIENT_MSG_ID_INVALID/);
  // Real HTTP, real authenticated device token and real MySQL index:
  // CI Vitest's in-memory agent fixture cannot assert durable SQL semantics.
  const agentToken = 'itk_dev_' + crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(agentToken).digest('hex');
  const host = 'N28-HTTP-' + crypto.randomBytes(5).toString('hex');
  await pool.query(
    "INSERT INTO devices (id, tenant_id, hostname, device_uid, device_token_hash, agent_token_revoked, status) VALUES (?, ?, ?, ?, ?, 0, 'registered')",
    [deviceA, tenantA, host, 'n28-device-'+deviceA, tokenHash]
  );
  const httpKey = 'http-'+crypto.randomBytes(12).toString('hex');
  const body = { hostname: host,
    events: [{ kind: 'n28_replay', client_msg_id: httpKey, payload: { free_gb: 0 } }] };
  const post = payload => request(app).post('/api/v1/ingest/telemetry')
    .set('X-Device-Token', agentToken).send(payload);
  const first = await post(body);
  assert.equal(first.status, 200, 'authenticated first event HTTP ACK');
  assert.equal(first.body.accepted, 1);
  const retry = await post(body);
  assert.equal(retry.status, 200, 'authenticated replay returns 200');
  assert.equal(retry.body.accepted, 1);
  const conflict = await post({ hostname: host, events: [
    { kind: 'n28_replay', client_msg_id: httpKey, payload: { free_gb: 50 } }
  ] });
  assert.equal(conflict.status, 409, 'reused key with different payload must return HTTP 409');
  assert.equal(conflict.body.error, 'EVENT_IDEMPOTENCY_CONFLICT');
  const badId = await post({ hostname: host, events: [{ kind: 'n28_replay', client_msg_id: 'invalid id' }] });
  assert.equal(badId.status, 400, 'invalid message key must fail schema validation');
  const [httpRows] = await pool.query(
    'SELECT COUNT(*) AS n FROM events WHERE tenant_id = ? AND device_id = ? AND client_msg_id = ?',
    [tenantA, deviceA, httpKey]
  );
  assert.equal(Number(httpRows[0].n), 1, 'HTTP replay creates only one durable event row');

  console.log('N28 PASS: 24-way MySQL concurrency, conflict safety, tenant/device scoping, legacy');
}finally{
  await pool.query('DELETE FROM events WHERE tenant_id IN (?, ?)',[tenantA,tenantB]);
  await pool.query('DELETE FROM devices WHERE id = ? AND tenant_id = ?', [deviceA, tenantA]);
  await pool.end();
  db.stopDbHealthCheck();
  db.stopTelemetryFlushWorker?.();
}
