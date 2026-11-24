#!/usr/bin/env node
// Stage 7: isolated, real HTTP integration for two production-mode API workers
// sharing one MySQL 8 backend. No external URLs, customer tenants or secrets.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.AADITECH_HTTP_REHEARSAL !== 'isolated-ci' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.DB_NAME !== 'it_toolkit') {
  throw new Error('Refusing HTTP concurrency rehearsal outside isolated GitHub Actions test MySQL');
}
for (const key of ['DB_USER','DB_PASSWORD','JWT_SECRET','BOOTSTRAP_SECRET',
                   'COMMAND_SIGNING_KEY','HMAC_SECRET','API_TOKEN']) {
  if (!process.env[key]) throw new Error('Missing CI secret: ' + key);
}
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, connectionLimit: 10, multipleStatements: true
});
const idA = crypto.randomUUID(), idB = crypto.randomUUID();
const prefix = 'STAGE7-' + crypto.randomBytes(5).toString('hex');
const live = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tokenHash = raw => crypto.createHash('sha256').update(raw).digest('hex');
const makeBootstrap = tenantId => {
  const payload = tenantId + ':' + crypto.randomUUID() + ':' + (Date.now() + 3600000);
  const signature = crypto.createHmac('sha256', process.env.BOOTSTRAP_SECRET)
    .update(payload).digest('hex');
  return Buffer.from(payload + ':' + signature).toString('base64url');
};
async function port() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  return value;
}
async function call(workerPort, uri, payload, jwtToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (jwtToken) headers.Authorization = 'Bearer ' + jwtToken;
  const response = await fetch('http://127.0.0.1:' + workerPort + uri, {
    method: 'POST', headers, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 160) }; }
  return { status: response.status, body };
}
async function agentCall(workerPort, hostname, deviceToken) {
  const response = await fetch('http://127.0.0.1:' + workerPort + '/api/v1/ingest/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
    body: JSON.stringify({ hostname, batch_id: crypto.randomUUID(), cpu_usage: '6%', memory_usage: '12%' }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 160) }; }
  return { status: response.status, body };
}
async function ready(workerPort) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const r = await fetch('http://127.0.0.1:' + workerPort + '/healthz', {
        signal: AbortSignal.timeout(750)
      });
      if (r.status === 200 && (await r.json()).components.database === 'HEALTHY') return;
    } catch {}
    await sleep(300);
  }
  throw new Error('Production HTTP worker did not become MySQL-ready: port ' + workerPort);
}
async function worker(workerPort) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, PORT: String(workerPort), NODE_ENV: 'production',
      VITEST: 'false', SETUP_TOKEN: crypto.randomBytes(32).toString('hex'),
      DB_RETRY_DELAYS: '500,1000,2000'
    },
    stdio: ['ignore','pipe','pipe']
  });
  let diagnostic = '';
  const save = buffer => { diagnostic = (diagnostic + String(buffer)).slice(-1800); };
  child.stdout.on('data', save); child.stderr.on('data', save);
  live.push(child);
  try { await ready(workerPort); }
  catch (err) { throw new Error(err.message + ' :: ' + diagnostic); }
}
const assertStatuses = (results, success, rejected, context) => {
  const successCount = results.filter(r => r.status === success).length;
  assert.equal(successCount, 1, context + ': must have exactly one success: ' +
    JSON.stringify(results.map(r => ({ status: r.status, error: r.body?.error }))));
  assert.ok(results.filter(r => r.status !== success).every(r => rejected.includes(r.status)),
    context + ': unexpected unsuccessful HTTP status');
};
async function count(sql, parameters = []) {
  const [rows] = await pool.query(sql, parameters);
  return Number(rows[0].total);
}
async function createTenant(tenantId, tag) {
  await pool.execute('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)',
    [tenantId, prefix + '-' + tag, (prefix + '-' + tag).toLowerCase()]);
  const [company] = await pool.execute(
    'INSERT INTO companies (tenant_id, name) VALUES (?, ?)', [tenantId, prefix + '-company-' + tag]);
  const username = (prefix + '-' + tag).toLowerCase();
  const [user] = await pool.execute(
    'INSERT INTO users (tenant_id, company_id, username, email, password_hash, role, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [tenantId, company.insertId, username, username + '@example.invalid', 'unused-test-only',
      'SUPER_ADMIN', 1]);
  return jwt.sign({
    id: user.insertId, username, role: 'SUPER_ADMIN', tenant_id: tenantId,
    jti: crypto.randomUUID()
  }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '10m' });
}
async function confirmClaims(hostname, uid, expected = 1) {
  const total = await count('SELECT COUNT(*) AS total FROM devices WHERE hostname = ? OR device_uid = ?',
    [hostname, uid]);
  assert.equal(total, expected, 'Unexpected persistent device ownership count');
}

let schemaInitialized = false;
try {
  await pool.query('SELECT 1');
  // The prior migration-runner test validates migration SQL but does not
  // necessarily provision tables in this separate CI service. Apply the
  // same authoritative schema used by Docker's MySQL init before seeding
  // the synthetic tenants. The workload still runs with production servers.
  await pool.query(fs.readFileSync('database/mysql/schema.sql', 'utf8'));
  schemaInitialized = true;
  const adminA = await createTenant(idA, 'a');
  const adminB = await createTenant(idB, 'b');
  const workerPorts = [await port(), await port()];
  assert.notEqual(workerPorts[0], workerPorts[1]);
  // Startup is sequential to keep schema migrations deterministic; HTTP
  // requests below are intentionally sent concurrently to both workers.
  await worker(workerPorts[0]);
  await worker(workerPorts[1]);
  console.log('[HTTP] Two independent production-mode API workers are MySQL-ready.');

  // Same hostname, competing tenant/UID, distinct one-use bootstrap tokens.
  const commonHost = prefix + '-ENROLL-HOST';
  const hostCases = Array.from({ length: 6 }, (_, i) => ({
    tenant: i % 2 ? idA : idB, hostname: commonHost,
    uid: prefix + '-HOST-UID-' + i
  }));
  const hostTokens = hostCases.map(c => makeBootstrap(c.tenant));
  const hostResults = await Promise.all(hostCases.map((c, i) =>
    call(workerPorts[i % 2], '/api/v1/agent/enroll', {
      hostname: c.hostname, device_uid: c.uid, bootstrap_token: hostTokens[i]
    })));
  assertStatuses(hostResults, 201, [409], 'cross-tenant same-host enrollment');
  assert.equal(await count('SELECT COUNT(*) AS total FROM devices WHERE hostname = ?', [commonHost]), 1);
  // Both live production workers must honor revocation/rotation committed
  // directly by another MySQL client, without sharing an in-process cache.
  const enrolledToken = hostResults.find(r => r.status === 201).body.device_token;
  assert.ok(enrolledToken?.startsWith('itk_dev_'), 'Enrollment did not issue a per-device token');
  const beforeRevocation = await Promise.all(workerPorts.map(p => agentCall(p, commonHost, enrolledToken)));
  assert.ok(beforeRevocation.every(r => [200, 202].includes(r.status)),
    'Both workers must initially accept the enrolled device token: ' +
    JSON.stringify(beforeRevocation.map(r => r.status)));

  await pool.execute('UPDATE devices SET agent_token_revoked = 1 WHERE hostname = ?', [commonHost]);
  const afterRevocation = await Promise.all(workerPorts.map(p => agentCall(p, commonHost, enrolledToken)));
  assert.ok(afterRevocation.every(r => r.status === 401 && r.body.error === 'DEVICE_TOKEN_REVOKED'),
    'A replica accepted a device token revoked by another database connection: ' +
    JSON.stringify(afterRevocation.map(r => ({ status: r.status, error: r.body.error }))));

  const replacementToken = 'itk_dev_' + crypto.randomBytes(24).toString('hex');
  await pool.execute(
    'UPDATE devices SET agent_token_revoked = 0, device_token_hash = ? WHERE hostname = ?',
    [tokenHash(replacementToken), commonHost]
  );
  const afterRotation = await Promise.all(workerPorts.map(p => agentCall(p, commonHost, enrolledToken)));
  assert.ok(afterRotation.every(r => r.status === 401),
    'A replica accepted a device token rotated by another database connection');
  const replacementAccepted = await Promise.all(workerPorts.map(p => agentCall(p, commonHost, replacementToken)));
  assert.ok(replacementAccepted.every(r => [200, 202].includes(r.status)),
    'Rotated enrolled token was not accepted by both API processes');
  console.log('[PASS] Cross-instance HTTP device token revocation and rotation without cache delay.');

  const loser = hostResults.findIndex(r => r.status === 409);
  assert.equal(await count('SELECT COUNT(*) AS total FROM used_bootstrap_tokens WHERE token_hash = ?',
    [tokenHash(hostTokens[loser])]), 0, 'Rejected identity consumed one-use credential');
  // Rejected token can still provision a genuinely new identity.
  const retry = await call(workerPorts[(loser + 1) % 2], '/api/v1/agent/enroll', {
    hostname: prefix + '-RETRY', device_uid: prefix + '-RETRY-UID',
    bootstrap_token: hostTokens[loser]
  });
  assert.equal(retry.status, 201, 'Identity conflict should not burn an unused token');
  console.log('[PASS] HTTP cross-tenant hostname contention and rejected-token reuse.');

  // Same UID, different hostnames and alternating tenants.
  const commonUid = prefix + '-SHARED-UID';
  const uidCases = Array.from({ length: 6 }, (_, i) => ({
    tenant: i % 2 ? idB : idA, hostname: prefix + '-UID-HOST-' + i
  }));
  const uidResults = await Promise.all(uidCases.map((c, i) =>
    call(workerPorts[i % 2], '/api/v1/agent/enroll', {
      hostname: c.hostname, device_uid: commonUid,
      bootstrap_token: makeBootstrap(c.tenant)
    })));
  assertStatuses(uidResults, 201, [409], 'cross-tenant same-UID enrollment');
  assert.equal(await count('SELECT COUNT(*) AS total FROM devices WHERE device_uid = ?', [commonUid]), 1);
  console.log('[PASS] HTTP cross-tenant UID contention.');

  // Same one-use bootstrap token replayed to two unrelated hosts on two
  // workers: only one request may redeem the hash; no double enrollment.
  const oneUse = makeBootstrap(idA);
  const replay = await Promise.all([0, 1].map(i =>
    call(workerPorts[i], '/api/v1/agent/enroll', {
      hostname: prefix + '-REPLAY-HOST-' + i,
      device_uid: prefix + '-REPLAY-UID-' + i, bootstrap_token: oneUse
    })));
  assertStatuses(replay, 201, [401], 'simultaneous one-use token replay');
  assert.equal(await count('SELECT COUNT(*) AS total FROM used_bootstrap_tokens WHERE token_hash = ?',
    [tokenHash(oneUse)]), 1);
  const [used] = await pool.execute(
    'SELECT token FROM used_bootstrap_tokens WHERE token_hash = ?', [tokenHash(oneUse)]);
  assert.equal(used[0].token, null, 'Redeemed plaintext token must never be persisted');
  console.log('[PASS] HTTP one-use token replay across both workers (hash-only).');

  // Administrative registration takes the same locks, using real JWT-backed
  // tenant identities in MySQL, not test-profile master-agent shortcuts.
  const registrationHost = prefix + '-REGISTER-HOST';
  const regRequests = Array.from({ length: 6 }, (_, i) =>
    call(workerPorts[i % 2], '/api/v1/devices', {
      hostname: registrationHost,
      device_uid: prefix + '-REG-UID-' + i,
      os_type: 'WINDOWS'
    }, i % 2 ? adminA : adminB));
  const regResults = await Promise.all(regRequests);
  assertStatuses(regResults, 201, [409], 'cross-tenant admin registration');
  assert.equal(await count('SELECT COUNT(*) AS total FROM devices WHERE hostname = ?',
    [registrationHost]), 1);
  console.log('[PASS] HTTP JWT-backed tenant registration contention.');

  const concurrentIndependent = await Promise.all(Array.from({ length: 4 }, (_, i) =>
    call(workerPorts[i % 2], '/api/v1/agent/enroll', {
      hostname: prefix + '-FREE-HOST-' + i,
      device_uid: prefix + '-FREE-UID-' + i,
      bootstrap_token: makeBootstrap(i % 2 ? idA : idB)
    })));
  assert.ok(concurrentIndependent.every(r => r.status === 201),
    'Independent identities must enroll concurrently: ' +
      JSON.stringify(concurrentIndependent.map(r => r.status)));
  console.log('[PASS] Independent real-HTTP registrations across tenant processes.');
  console.log('[PASS] Production-mode two-process HTTP tenant isolation and token replay rehearsal.');
} finally {
  for (const child of live) child.kill('SIGTERM');
  await Promise.all(live.map(async child => {
    if (child.exitCode !== null || child.signalCode) return;
    await Promise.race([once(child, 'exit').catch(() => {}), sleep(2000)]);
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
  }));
  try {
    if (schemaInitialized) {
      await pool.query('DELETE FROM used_bootstrap_tokens WHERE tenant_id IN (?, ?)', [idA, idB]);
      await pool.query('DELETE FROM devices WHERE tenant_id IN (?, ?)', [idA, idB]);
      await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?)', [idA, idB]);
      await pool.query('DELETE FROM companies WHERE tenant_id IN (?, ?)', [idA, idB]);
      await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [idA, idB]);
    }
  } finally {
    await pool.end();
  }
}
