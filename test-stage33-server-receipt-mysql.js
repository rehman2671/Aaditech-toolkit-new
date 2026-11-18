#!/usr/bin/env node
// N33 disposable CI MySQL only. No real customer tenant or credentials.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import mysql from 'mysql2/promise';
import * as db from './db.js';
import {sha256, validateEvidence, verifyScopedReceipt} from './Enterprise/deploy/stage33-receipt-core.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.AADITECH_STAGE33_REHEARSAL !== 'isolated-ci' ||
    process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'it_toolkit')
  throw new Error('N33 verifier rehearsal requires disposable CI MySQL');
const pool=mysql.createPool({
  host:process.env.DB_HOST || '127.0.0.1',port:Number(process.env.DB_PORT || 3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,
  connectionLimit:4
});
const tenant=crypto.randomUUID(),device='N33-'+crypto.randomBytes(8).toString('hex');
const batch=crypto.randomBytes(16).toString('hex'),runId=crypto.randomBytes(16).toString('hex');
const digest=sha256('n33-local-immutable-body'),queueHash='b'.repeat(64);
const requestHash=sha256(JSON.stringify({batch_id:batch,device_id:device}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'n33-receipt-'));
const offlinePath=path.join(root,'stage32-offline.json');
const recoveredPath=path.join(root,'stage32-recovered.json');
const identityPath=path.join(root,'identity-private.json');
const outputPath=path.join(root,'receipt.json');
const offline={
  schema:'aaditech-stage32-offline-v1',run_id:runId,
  captured_utc:'2026-11-18T04:00:00.000Z',phase:'OFFLINE_OPERATOR_ATTESTED',
  queue_identity_sha256:queueHash,batch_id:batch,payload_sha256:digest,
  event_ids_sha256:'d'.repeat(64),in_flight_events:2,sqlite_integrity:'ok',
  network_interruption_independently_measured:false,
  server_receipt_independently_verified:false,certified_for_production:false
};
let failure;
const write=(f,value)=>fs.writeFileSync(f,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const invoke=(out,identity=identityPath)=>spawnSync(process.execPath,[
  path.resolve('Enterprise/deploy/verify-stage33-server-receipt.mjs'),
  '--evidence-dir',root,'--identity-file',identity,'--output',out
],{env:{...process.env,DB_HOST:'127.0.0.1',DB_PORT:process.env.DB_PORT || '3306'},
  encoding:'utf8',timeout:18000});
const expectsFailure=(name,out,identityFile=identityPath)=>{
  const result=invoke(out,identityFile);
  assert.equal(result.status,1,name+' must fail closed; stderr='+result.stderr);
  assert.match(result.stderr,/N33 BLOCKED/);
  assert(!result.stdout.includes(tenant)&&!result.stderr.includes(tenant));
  assert(!result.stdout.includes(process.env.DB_PASSWORD)&&!result.stderr.includes(process.env.DB_PASSWORD));
  assert(!fs.existsSync(out),name+' must not create report');
};
try {
  await db.attemptConnection();
  await pool.query('INSERT INTO tenants(id,name,slug) VALUES(?,?,?)',[
    tenant,'N33 disposable','n33-'+crypto.randomBytes(6).toString('hex')]);
  await pool.query('INSERT INTO devices(id,tenant_id,hostname,device_uid,status) VALUES(?,?,?,?,?)',[
    device,tenant,'N33 TEST','n33-'+device,'registered']);
  await pool.query(
    'INSERT INTO telemetry_batches(tenant_id,device_id,batch_id,request_hash,insert_nonce,accepted_count) VALUES(?,?,?,?,?,?)',
    [tenant,device,batch,requestHash,'c'.repeat(32),2]
  );
  write(offlinePath,offline);
  const recovered={
    schema:'aaditech-stage32-recovered-v1',run_id:runId,
    captured_utc:'2026-11-18T04:01:00.000Z',phase:'LOCAL_SQLITE_ACK_OBSERVED',
    batch_id:batch,payload_sha256:digest,queue_identity_sha256:queueHash,
    local_ack_observed:true,delivered_event_count:2,
    offline_evidence_sha256:sha256(fs.readFileSync(offlinePath)),
    network_interruption_independently_measured:false,
    server_receipt_independently_verified:false,certified_for_production:false
  };
  write(recoveredPath,recovered);
  write(identityPath,{case_run_id:runId,tenant_id:tenant,device_id:device});
  const ctx=validateEvidence(offline,recovered,{case_run_id:runId,tenant_id:tenant,device_id:device},
    fs.readFileSync(offlinePath),fs.readFileSync(recoveredPath));
  const queries=[];
  const found=await verifyScopedReceipt(async(sql,params)=>{
    queries.push({sql,params});
    const [rows]=await pool.query(sql,params);
    return rows;
  },ctx);
  assert.equal(queries.length,1,'single scoped SELECT');
  assert(queries[0].sql.startsWith('SELECT '),'read-only query');
  assert.deepEqual(queries[0].params,[tenant,device,batch]);
  assert.equal(found.scoped_mysql_receipt_verified,true);
  assert.equal(found.accepted_count,2);
  assert.equal(found.production_certified,false);
  assert.equal(found.report_authenticated_to_operator,false);
  assert.equal(found.raw_http_json_hash_matched,false);
  assert(!JSON.stringify(found).includes(tenant)&&!JSON.stringify(found).includes(device));
  const verified=invoke(outputPath);
  assert.equal(verified.status,0,'CLI must validate real MySQL: '+verified.stderr);
  const report=JSON.parse(fs.readFileSync(outputPath,'utf8'));
  assert.equal(report.accepted_count,2);
  assert.equal(report.batch_id,batch);
  assert.equal(report.offline_evidence_sha256,sha256(fs.readFileSync(offlinePath)));
  assert.equal(report.recovered_evidence_sha256,sha256(fs.readFileSync(recoveredPath)));
  assert.equal(report.production_certified,false);
  assert.equal(fs.statSync(outputPath).mode & 0o777,0o600);
  assert(!fs.readFileSync(outputPath,'utf8').includes(tenant));
  assert(!fs.readFileSync(outputPath,'utf8').includes(device));
  const originalOutputBytes=fs.readFileSync(outputPath);
  const deniedOverwrite=invoke(outputPath);
  assert.equal(deniedOverwrite.status,1,'existing evidence must reject overwrite');
  assert.match(deniedOverwrite.stderr,/N33 BLOCKED: REFUSING_OVERWRITE/);
  assert.deepEqual(fs.readFileSync(outputPath),originalOutputBytes,'overwrite denial preserves existing report bytes');
  const wrongOwner=path.join(root,'wrong-owner.json');
  write(wrongOwner,{case_run_id:runId,tenant_id:crypto.randomUUID(),device_id:device});
  expectsFailure('wrong tenant',path.join(root,'wrong-tenant-report.json'),wrongOwner);
  write(wrongOwner,{case_run_id:runId,tenant_id:tenant,device_id:'N33-other'});
  expectsFailure('wrong device',path.join(root,'wrong-device-report.json'),wrongOwner);
  write(wrongOwner,{case_run_id:'a'.repeat(32),tenant_id:tenant,device_id:device});
  expectsFailure('wrong case',path.join(root,'wrong-case-report.json'),wrongOwner);
  write(recoveredPath,{...recovered,payload_sha256:'e'.repeat(64)});
  expectsFailure('tampered local payload',path.join(root,'tampered-report.json'));
  write(recoveredPath,recovered);
  await pool.query('UPDATE telemetry_batches SET accepted_count=1 WHERE tenant_id=? AND device_id=? AND batch_id=?',
    [tenant,device,batch]);
  expectsFailure('mismatched accepted count',path.join(root,'wrong-count-report.json'));
  await pool.query('DELETE FROM telemetry_batches WHERE tenant_id=? AND device_id=? AND batch_id=?',
    [tenant,device,batch]);
  expectsFailure('missing server receipt',path.join(root,'missing-report.json'));
  console.log('N33 PASS: scoped MySQL receipt and event count, wrong tenant/device, tampering, permission, missing row and no-write evidence');
} catch(e) {
  failure=e;
  console.error('N33 FAIL:',e);
} finally {
  try {
    await pool.query('DELETE FROM telemetry_batches WHERE tenant_id=? AND device_id=?',[tenant,device]);
    await pool.query('DELETE FROM devices WHERE id=?',[device]);
    await pool.query('DELETE FROM tenants WHERE id=?',[tenant]);
  } catch(e) {failure ||= e; console.error('N33 fixture cleanup:',e.message);}
  await pool.end();
  db.stopDbHealthCheck();
  db.stopTelemetryFlushWorker?.();
  fs.rmSync(root,{recursive:true,force:true});
}
process.exit(failure?1:0);
