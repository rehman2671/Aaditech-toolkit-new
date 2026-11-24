#!/usr/bin/env node
// Stage N29: disposable GitHub Actions MySQL ONLY; no customer tenants.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import request from 'supertest';
import * as db from './db.js';
import {createRecoveryReviewRequest,reserveRecoveryReview,inspectRecoveryReview} from './device-recovery-review.js';
import {createTroubleshootingIncident,inspectTroubleshootingIncident,recordDiagnosticPlan,summarizeTroubleshootingIntake} from './troubleshooting-incidents.js';
import {withSchemaMigrationLock} from './schema-migration-lock.js';

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
const reviewDevice=crypto.randomUUID(), reviewTenant=crypto.randomUUID();
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
  // Explicit credential argument exercises the deployed write boundary even
  // in this isolated test-mode fixture.
  const bound = { tokenHash };
  const prior = await db.ingestTelemetryBatchOnce(base, bound);
  assert.equal(prior.duplicate,true);
  const usageKey=key+'-usage', emptyKey=key+'-empty';
  const usage={...base,batch_id:usageKey,request_hash:sha(usageKey),events:[],alerts:[],metrics:null,app_usage:[{name:'CI inert app',seconds:12}]};
  const empty={...usage,batch_id:emptyKey,request_hash:sha(emptyKey),app_usage:[]};
  await db.ingestTelemetryBatchOnce(usage,bound);
  assert.deepEqual((await db.getCurrentAppUsageSnapshot(devA,tenantA)).app_usage,usage.app_usage);
  assert.equal(await db.getCurrentAppUsageSnapshot(devA,tenantB),null);
  await db.ingestTelemetryBatchOnce(empty,bound);
  assert.equal((await db.ingestTelemetryBatchOnce(usage,bound)).duplicate,true);
  assert.deepEqual((await db.getCurrentAppUsageSnapshot(devA,tenantA)).app_usage,[]);
  await assert.rejects(()=>db.ingestTelemetryBatchOnce({...usage,batch_id:key+'-oversize',app_usage:[{name:'x'.repeat(65537)}]},bound),/TELEMETRY_APP_USAGE_INVALID/);
  assert.equal(await countReceipt(key+'-oversize'),0);
  await pool.query('UPDATE devices SET device_token_hash=? WHERE id=?',['c'.repeat(64),devA]);
  assert.equal(await db.getCurrentAppUsageSnapshot(devA,tenantA),null);
  await pool.query('UPDATE devices SET device_token_hash=? WHERE id=?',[tokenHash,devA]);
  await pool.query('UPDATE device_app_usage_snapshots SET recorded_at=DATE_SUB(NOW(3),INTERVAL 16 MINUTE) WHERE device_id=?',[devA]);
  assert.equal(await db.getCurrentAppUsageSnapshot(devA,tenantA),null);
  await db.ingestTelemetryBatchOnce({...usage,batch_id:key+'-fresh',request_hash:sha(key+'-fresh')},bound);
  assert.ok(await db.getCurrentAppUsageSnapshot(devA,tenantA));
  const historyBeforeRevocation = await countHistory();
  await pool.query('UPDATE devices SET agent_token_revoked=1 WHERE id=?',[devA]);
  assert.equal(await db.getCurrentAppUsageSnapshot(devA,tenantA),null);
  await assert.rejects(()=>db.ingestTelemetryBatchOnce(base,bound),/TELEMETRY_CREDENTIAL_CHANGED/);
  await assert.rejects(()=>db.ingestTelemetryBatchOnce({...base,batch_id:key+'-revoked'},bound),/TELEMETRY_CREDENTIAL_CHANGED/);
  assert.equal(await countReceipt(key+'-revoked'),0);
  assert.equal(await countHistory(),historyBeforeRevocation);
  await assert.rejects(()=>db.recordCredentialBoundHeartbeat(devA,{tenantId:tenantA,tokenHash}),/COMMAND_CREDENTIAL_CHANGED/);
  // Review-only recovery: real InnoDB concurrent reservation, no token issuance.
  const label='review-'+crypto.randomBytes(8).toString('hex');
  await pool.query('INSERT INTO tenants (id,name,slug) VALUES (?,?,?)',[reviewTenant,label,label]);
  await pool.query("INSERT INTO devices (id,tenant_id,hostname,device_uid,device_token_hash,agent_token_revoked,status) VALUES (?,?,?,?,?,1,'registered')",
    [reviewDevice,reviewTenant,label,label,sha(label)]);
  const admins=[];
  for(const suffix of ['-requester','-reviewer']){
    const [u]=await pool.query("INSERT INTO users (tenant_id,username,email,password_hash,role,active,status) VALUES (?,?,?,?,'SUPER_ADMIN',1,'ACTIVE')",[reviewTenant,label+suffix,label+suffix+'@invalid.example','CI-only-no-login']);
    admins.push({id:u.insertId,tenant_id:reviewTenant,role:'SUPER_ADMIN'});
  }
  const requests=await Promise.allSettled(Array.from({length:4},()=>createRecoveryReviewRequest(pool,{principal:admins[0],deviceId:reviewDevice})));
  assert.equal(requests.filter(x=>x.status==='fulfilled').length,1);
  const req=requests.find(x=>x.status==='fulfilled').value;
  const [clock]=await pool.query('SELECT CAST(UNIX_TIMESTAMP(NOW(3))*1000 AS UNSIGNED) AS now_ms');
  const now=Number(clock[0].now_ms), keys=crypto.generateKeyPairSync('ed25519');
  const payload=Buffer.from(JSON.stringify({schema:'aaditech-device-recovery-evidence-v1',purpose:'REVIEW_ONLY_CREDENTIAL_RECOVERY',tenant_id:reviewTenant,device_id:reviewDevice,request_id:req.request_id,challenge_sha256:req.challenge_sha256,credential_fingerprint:req.credential_fingerprint,ownership_evidence_sha256:'c'.repeat(64),command_reconciliation_sha256:'d'.repeat(64),local_handoff_evidence_sha256:'e'.repeat(64),issued_at_ms:now-100,expires_at_ms:now+120000}));
  const options={principal:admins[1],deviceId:reviewDevice,requestId:req.request_id,
    evidence:{payload,signature:crypto.sign(null,payload,keys.privateKey)},
    trustedPins:{payloadSha256:sha(payload),reviewerSpkiSha256:sha(keys.publicKey.export({type:'spki',format:'der'})),reviewerPublicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),ownershipEvidenceSha256:'c'.repeat(64),commandReconciliationSha256:'d'.repeat(64),localHandoffEvidenceSha256:'e'.repeat(64)}};
  await assert.rejects(()=>reserveRecoveryReview(pool,{...options,principal:admins[0]}),/RECOVERY_REVIEW_NOT_RESERVABLE/);
  await pool.query('UPDATE users SET active=0 WHERE id=?',[admins[0].id]);
  await assert.rejects(()=>reserveRecoveryReview(pool,options),/RECOVERY_REVIEW_ACTOR_DENIED/);
  await pool.query('UPDATE users SET active=1 WHERE id=?',[admins[0].id]);
  await assert.rejects(()=>reserveRecoveryReview(pool,{...options,trustedPins:{...options.trustedPins,ownershipEvidenceSha256:'f'.repeat(64)}}),/RECOVERY_REVIEW_ARTIFACT_MISMATCH/);
  const reviews=await Promise.allSettled(Array.from({length:4},()=>reserveRecoveryReview(pool,options)));
  assert.equal(reviews.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(reviews.find(x=>x.status==='fulfilled').value.replacement_allowed,false);
  const inspected=await inspectRecoveryReview(pool,{principal:admins[1],deviceId:reviewDevice,requestId:req.request_id});
  assert.equal(inspected.status,'REVIEW_RESERVED');
  assert.equal(inspected.replacement_allowed,false);
  assert.equal(Object.hasOwn(inspected,'credential_fingerprint'),false);
  const [stillRevoked]=await pool.query('SELECT agent_token_revoked,device_token_hash FROM devices WHERE id=?',[reviewDevice]);
  assert.equal(Number(stillRevoked[0].agent_token_revoked),1);
  assert.equal(stillRevoked[0].device_token_hash,sha(label));
  assert.equal(await single("SELECT COUNT(*) AS n FROM audit_logs WHERE tenant_id=? AND action IN ('DEVICE_RECOVERY_REVIEW_REQUESTED','DEVICE_RECOVERY_REVIEW_RESERVED')",[reviewTenant]),2);
  // An expired reservation must not block a fresh review, and its unique
  // evidence/challenge tombstone must remain intact.
  await assert.rejects(()=>createRecoveryReviewRequest(pool,{principal:admins[0],deviceId:reviewDevice}),/RECOVERY_REVIEW_ALREADY_OPEN/);
  await pool.query('UPDATE device_recovery_reviews SET review_expires_at_ms=reviewed_at_ms+1 WHERE request_id=?',[req.request_id]);
  await pool.query('SELECT SLEEP(0.02)');
  const newRequest=await createRecoveryReviewRequest(pool,{principal:admins[0],deviceId:reviewDevice});
  assert.notEqual(newRequest.request_id,req.request_id);
  assert.equal(await single('SELECT COUNT(*) AS n FROM device_recovery_reviews WHERE tenant_id=? AND device_id=?',[reviewTenant,reviewDevice]),2);
  console.log('[PASS] Durable review request and reservation serialize across connections, expired reservation permits fresh review, no credential mutation.');
  const installationId=crypto.randomUUID(),requestId=crypto.randomUUID();
  const incidentInput={principal:admins[0],installationId,deviceId:reviewDevice,requestId,categoryId:'TR-24',hazard:'PHYSICAL_HAZARD'};
  const incidents=await Promise.all(Array.from({length:6},()=>createTroubleshootingIncident(pool,incidentInput)));
  assert.equal(new Set(incidents.map(x=>x.incident_id)).size,1);
  assert.equal(incidents.filter(x=>!x.duplicate).length,1);
  assert.equal(incidents[0].status,'ESCALATED');
  assert.equal(incidents[0].repair_authorized,false);
  await assert.rejects(()=>createTroubleshootingIncident(pool,{...incidentInput,categoryId:'TR-01'}),/INCIDENT_IDEMPOTENCY_CONFLICT/);
  const incidentArgs={principal:admins[0],installationId,deviceId:reviewDevice,incidentId:incidents[0].incident_id};
  assert.equal((await inspectTroubleshootingIncident(pool,incidentArgs)).status,'ESCALATED');
  await assert.rejects(()=>inspectTroubleshootingIncident(pool,{...incidentArgs,principal:admins[1]}),/INCIDENT_NOT_FOUND/);
  await assert.rejects(()=>inspectTroubleshootingIncident(pool,{...incidentArgs,installationId:crypto.randomUUID()}),/INCIDENT_NOT_FOUND/);
  assert.equal(await single("SELECT COUNT(*) AS n FROM troubleshooting_incidents WHERE tenant_id=?",[reviewTenant]),1);
  assert.equal(await single("SELECT COUNT(*) AS n FROM audit_logs WHERE tenant_id=? AND action='TROUBLESHOOTING_INCIDENT_RECORDED'",[reviewTenant]),1);
  const planRequest=crypto.randomUUID();
  await assert.rejects(()=>recordDiagnosticPlan(pool,{...incidentArgs,requestId:planRequest}),/DIAGNOSTIC_PLAN_BLOCKED/);
  const openIncident=await createTroubleshootingIncident(pool,{...incidentInput,requestId:crypto.randomUUID(),categoryId:'TR-01',hazard:'NONE'});
  const planInput={...incidentArgs,incidentId:openIncident.incident_id,requestId:planRequest};
  const plans=await Promise.all(Array.from({length:6},()=>recordDiagnosticPlan(pool,planInput)));
  assert.equal(new Set(plans.map(x=>x.plan_id)).size,1);
  assert.equal(plans.filter(x=>!x.duplicate).length,1);
  assert.equal(plans[0].execution_authorized,false);
  assert.equal(await single("SELECT COUNT(*) AS n FROM troubleshooting_diagnostic_plans WHERE tenant_id=?",[reviewTenant]),1);
  assert.equal(await single("SELECT COUNT(*) AS n FROM audit_logs WHERE tenant_id=? AND action='TROUBLESHOOTING_DIAGNOSTIC_PLANNED'",[reviewTenant]),1);
  const summaryArgs={principal:admins[0],installationId,deviceId:reviewDevice};
  const summary=await summarizeTroubleshootingIntake(pool,summaryArgs);
  assert.deepEqual([summary.reported,summary.open,summary.escalated,summary.incidents_with_plans],[2,1,1,1]);
  assert.equal(summary.verified_resolved,null);
  assert.equal((await summarizeTroubleshootingIntake(pool,{...summaryArgs,principal:admins[1]})).reported,0);
  // Real separate connections must serialize on the schema advisory lock.
  const order=[];
  await Promise.all(Array.from({length:3},(_,i)=>withSchemaMigrationLock(pool,async c=>{
    order.push('enter'+i);
    const [r]=await c.query("SELECT IS_USED_LOCK('itk_schema_migrations_lock')=CONNECTION_ID() AS owned");
    assert.equal(Number(r[0].owned),1);
    await c.query('SELECT SLEEP(0.03)');
    order.push('exit'+i);
  })));
  assert.equal(order.length,6);
  for(let i=0;i<6;i+=2)assert.equal(order[i].replace('enter','exit'),order[i+1]);
  console.log('[PASS] Scoped intake summary and same-session migration lock serialization.');
  // A corrupted historical checksum must fail before any migration work.
  const [migrationRows]=await pool.query("SELECT checksum FROM schema_migrations WHERE version='019'");
  assert.equal(migrationRows.length,1);
  try {
    await pool.query("UPDATE schema_migrations SET checksum=? WHERE version='019'",['0'.repeat(64)]);
    await assert.rejects(()=>db.runDatabaseMigrations(),/MIGRATION_HISTORY_DRIFT/);
  } finally {
    await pool.query("UPDATE schema_migrations SET checksum=? WHERE version='019'",[migrationRows[0].checksum]);
  }
  assert.equal((await db.runDatabaseMigrations()).applied.length,0);
  console.log('[PASS] Migration history drift refused and original checksum restored in disposable CI.');
  // Exact tenant fixture only; no actual external delivery.
  const [outboxRows]=await pool.query('SELECT id FROM notification_outbox WHERE tenant_id=? ORDER BY id LIMIT 1',[tenantA]);
  assert.equal(outboxRows.length,1);
  const oid=outboxRows[0].id,lease=crypto.randomUUID();
  await pool.query("UPDATE notification_outbox SET status='PROCESSING', attempts=1, lease_token=?, lease_expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id=?",[lease,oid]);
  assert.equal(await db.finishNotificationOutbox(oid,lease,'DELIVERED'),false);
  assert.equal(await db.retryNotificationOutbox({id:oid,lease_token:lease,attempts:1},'FIXTURE_RETRY'),false);
  assert.equal(await single("SELECT COUNT(*) AS n FROM notification_outbox WHERE id=? AND lease_token=? AND status='PROCESSING'",[oid,lease]),1);
  await pool.query("UPDATE notification_outbox SET lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 60 SECOND) WHERE id=?",[oid]);
  assert.equal(await db.finishNotificationOutbox(oid,crypto.randomUUID(),'DELIVERED'),false);
  assert.equal(await db.retryNotificationOutbox({id:oid,lease_token:lease,attempts:1},'FIXTURE_RETRY'),true);
  assert.equal(await single("SELECT COUNT(*) AS n FROM notification_outbox WHERE id=? AND status='PENDING' AND lease_token IS NULL",[oid]),1);
  const nextLease=crypto.randomUUID();
  await pool.query("UPDATE notification_outbox SET status='PROCESSING', attempts=2, lease_token=?, lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 60 SECOND) WHERE id=?",[nextLease,oid]);
  assert.equal(await db.finishNotificationOutbox(oid,lease,'DELIVERED'),false);
  assert.equal(await db.finishNotificationOutbox(oid,nextLease,'DELIVERED'),true);
  assert.equal(await db.finishNotificationOutbox(oid,nextLease,'DELIVERED'),false);
  const testRule=await db.createAlertRule({tenant_id:tenantA,name:'N29-zero-'+key,metric:'disk',condition_op:'<=',threshold:0,enabled:false});
  assert.equal(Number((await db.getAlertRuleById(testRule.id)).threshold),0);
  assert.equal((await db.getAlertRuleById(testRule.id)).enabled,false);
  await pool.query('UPDATE alert_rules SET enabled=2 WHERE id=?',[testRule.id]);
  assert.equal((await db.getAlertRuleById(testRule.id)).enabled,false);
  console.log('[PASS] Expired outbox lease refusal, retry/ACK fencing, zero rule threshold and ambiguous SQL enablement.');
  console.log('N29 PASS: atomic rollback, MySQL worker races, single history/alert/outbox, HTTP replay, 409 and revoked credential write fencing');
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
    await pool.query('DELETE FROM troubleshooting_diagnostic_plans WHERE tenant_id=?',[reviewTenant]);
    await pool.query('DELETE FROM troubleshooting_incidents WHERE tenant_id=?',[reviewTenant]);
    await pool.query('DELETE FROM device_recovery_reviews WHERE tenant_id=?',[reviewTenant]);
    await pool.query('DELETE FROM audit_logs WHERE tenant_id=?',[reviewTenant]);
    await pool.query('DELETE FROM users WHERE tenant_id=?',[reviewTenant]);
    await pool.query('DELETE FROM devices WHERE id=?',[reviewDevice]);
    await pool.query('DELETE FROM tenants WHERE id=?',[reviewTenant]);
  } catch(err) { console.error('N29 test cleanup:',err.message);failure ||= err; }
  await pool.end();
  db.stopDbHealthCheck();
  db.stopTelemetryFlushWorker?.();
}
process.exit(failure ? 1 : 0);
