#!/usr/bin/env node
// N30: isolated disposable CI MySQL only, never customer data.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import * as db from './db.js';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.AADITECH_RECEIPT_RETENTION_REHEARSAL !== 'isolated-ci' ||
    process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'it_toolkit') {
  throw Error('Refusing batch receipt retention rehearsal outside isolated CI MySQL');
}
const pool=mysql.createPool({
  host:process.env.DB_HOST || '127.0.0.1',port:Number(process.env.DB_PORT || 3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,
  connectionLimit:10
});
const id=()=>crypto.randomUUID();
const activeTenant=id(),orphanOld=id(),orphanNew=id(),orphanWithDevice=id();
const activeDevice='N30-'+crypto.randomBytes(8).toString('hex');
const otherDevice='N30-'+crypto.randomBytes(8).toString('hex');
const batchId='N30-'+crypto.randomBytes(8).toString('hex');
const hash='a'.repeat(64), nonce='f'.repeat(32);
const total=async(tenant)=>{
  const [rows]=await pool.query('SELECT COUNT(*) AS n FROM telemetry_batches WHERE tenant_id=?',[tenant]);
  return Number(rows[0].n);
};
let error=null;
try {
  await db.attemptConnection();
  const [index]=await pool.query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() "+
    "AND TABLE_NAME='telemetry_batches' AND INDEX_NAME='idx_telemetry_batches_age'");
  assert(index.length>0,'migration 015 must create indexed age scan');
  await pool.query('INSERT INTO tenants(id,name,slug) VALUES(?,?,?)',[
    activeTenant,'N30 disposable','n30-'+crypto.randomBytes(8).toString('hex')]);
  await pool.query('INSERT INTO devices(id,tenant_id,hostname,device_uid,status) VALUES(?,?,?,?,?)',[
    activeDevice,activeTenant,'N30-ACTIVE','n30-active-'+activeDevice,'online']);
  // Even if tenant metadata has been deleted, a lingering enrolled device
  // means an old request might still replay. Protect that receipt as well.
  await pool.query('INSERT INTO devices(id,tenant_id,hostname,device_uid,status) VALUES(?,?,?,?,?)',[
    otherDevice,orphanWithDevice,'N30-STILL-ENROLLED','n30-orphan-'+otherDevice,'online']);
  const receipts=[
    [activeTenant,activeDevice,'active-'+batchId,hash,nonce],
    [orphanOld,'retired-'+batchId,'retired-'+batchId,hash,nonce],
    [orphanWithDevice,otherDevice,'dangling-'+batchId,hash,nonce]
  ];
  for(const row of receipts){
    await pool.query(
      'INSERT INTO telemetry_batches(tenant_id,device_id,batch_id,request_hash,insert_nonce,accepted_count,recorded_at) ' +
      'VALUES(?,?,?,?,?,0,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 400 DAY))',row);
  }
  await pool.query(
    'INSERT INTO telemetry_batches(tenant_id,device_id,batch_id,request_hash,insert_nonce,accepted_count,recorded_at) ' +
    'VALUES(?,?,?,?,?,0,UTC_TIMESTAMP(3))',
    [orphanNew,'recent-'+batchId,'recent-'+batchId,hash,nonce]
  );
  await assert.rejects(()=>db.maintainTelemetryBatchReceipts({
    dryRun:false,confirm:'WRONG'}),/TELEMETRY_BATCH_MAINTENANCE_CONFIRMATION_REQUIRED/);
  await assert.rejects(()=>db.maintainTelemetryBatchReceipts({minAgeDays:30}),
    /TELEMETRY_BATCH_MAINTENANCE_BOUNDS/);
  await assert.rejects(()=>db.maintainTelemetryBatchReceipts({limit:1000}),
    /TELEMETRY_BATCH_MAINTENANCE_BOUNDS/);

  const preview=await db.maintainTelemetryBatchReceipts();
  assert.equal(preview.status,'DRY_RUN');
  assert.equal(preview.deleted,0);
  assert.equal(preview.auto_pruning_enabled,false);
  assert(preview.eligible>=1,'old orphan eligible for operator preview');
  assert.equal(await total(orphanOld),1,'dry-run never erases orphan receipt');
  assert.equal(await total(activeTenant),1,'dry-run never touches active receipt');
  assert.equal(await total(orphanWithDevice),1,'device under deleted tenant protects receipt');
  assert.equal(await total(orphanNew),1,'recent orphan is below hard 180-day minimum');

  const replay=await db.ingestTelemetryBatchOnce({
    tenant_id:activeTenant,device_id:activeDevice,batch_id:'active-'+batchId,
    request_hash:hash,events:[]
  });
  assert.equal(replay.duplicate,true,'400-day-old live receipt still fences retries');
  await assert.rejects(()=>db.ingestTelemetryBatchOnce({
    tenant_id:activeTenant,device_id:activeDevice,batch_id:'active-'+batchId,
    request_hash:'b'.repeat(64),events:[]
  }),/TELEMETRY_BATCH_ID_CONFLICT/,'live key still rejects modified content');

  const purge=await db.maintainTelemetryBatchReceipts({
    dryRun:false,minAgeDays:180,limit:1,
    confirm:'PURGE_DECOMMISSIONED_BATCH_RECEIPTS'
  });
  assert.equal(purge.status,'PURGED_DECOMMISSIONED_ONLY');
  assert.equal(purge.deleted,1,'only one explicitly confirmed old orphan deleted');
  assert.equal(await total(orphanOld),0,'fully decommissioned old tenant removed');
  assert.equal(await total(activeTenant),1,'active tenant receipt never pruned');
  assert.equal(await total(orphanWithDevice),1,'enrolled device protects old key');
  assert.equal(await total(orphanNew),1,'recent orphan protected');
  const second=await db.maintainTelemetryBatchReceipts({
    dryRun:false,limit:100,
    confirm:'PURGE_DECOMMISSIONED_BATCH_RECEIPTS'
  });
  assert.equal(second.deleted,0,'no other safe eligible rows');
  console.log('N30 PASS: real MySQL 400-day replay, dry-run, 180-day floor, bounded orphan cleanup and owner guards');
} catch(e) {
  error=e;
  console.error('N30 FAIL:',e);
} finally {
  try {
    await pool.query('DELETE FROM telemetry_batches WHERE tenant_id IN (?,?,?,?)',
      [activeTenant,orphanOld,orphanNew,orphanWithDevice]);
    await pool.query('DELETE FROM devices WHERE id IN (?,?)',[activeDevice,otherDevice]);
    await pool.query('DELETE FROM tenants WHERE id=?',[activeTenant]);
  } catch(e){console.error('N30 fixture cleanup:',e.message);error ||= e;}
  await pool.end();
  db.stopDbHealthCheck();
  db.stopTelemetryFlushWorker?.();
}
process.exit(error?1:0);
