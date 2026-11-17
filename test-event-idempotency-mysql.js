#!/usr/bin/env node
// N28: disposable CI MySQL only. NEVER run against customer data.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import * as db from './db.js';
if(process.env.GITHUB_ACTIONS!=='true' ||
   process.env.AADITECH_EVENT_DEDUP_REHEARSAL!=='isolated-ci' ||
   process.env.NODE_ENV!=='test' || process.env.DB_NAME!=='it_toolkit'){
  throw Error('Refusing event retry rehearsal outside isolated GitHub Actions MySQL');
}
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
  console.log('N28 PASS: 24-way MySQL concurrency, conflict safety, tenant/device scoping, legacy');
}finally{
  await pool.query('DELETE FROM events WHERE tenant_id IN (?, ?)',[tenantA,tenantB]);
  await pool.end();
  db.stopDbHealthCheck();
  db.stopTelemetryFlushWorker?.();
}
