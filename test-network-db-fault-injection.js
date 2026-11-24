#!/usr/bin/env node
// Phase N Stage 8: isolate MySQL traffic behind a disposable TCP fault proxy.
// Only synthetic tenants, local loopback and the GitHub Actions MySQL service.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.AADITECH_DB_FAULT_REHEARSAL !== 'isolated-ci' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.DB_NAME !== 'it_toolkit') {
  throw new Error('Refusing DB fault injection outside disposable GitHub CI');
}
for (const name of ['DB_USER', 'DB_PASSWORD', 'JWT_SECRET',
  'BOOTSTRAP_SECRET', 'COMMAND_SIGNING_KEY', 'HMAC_SECRET', 'API_TOKEN']) {
  if (!process.env[name]) throw new Error('Missing CI-only credential: ' + name);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tenantId = crypto.randomUUID();
const prefix = 'STAGE8-' + crypto.randomBytes(5).toString('hex');
const realHost = process.env.DB_HOST || '127.0.0.1';
const realPort = Number(process.env.DB_PORT || 3306);
const pool = mysql.createPool({
  host: realHost, port: realPort, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  connectionLimit: 4, multipleStatements: true
});
const live = [];
const sockets = new Set();
let dropped = false;
let schemaReady = false;
let listening = false;
const proxy = net.createServer(client => {
  if (dropped) { client.destroy(); return; }
  const upstream = net.createConnection({ host: realHost, port: realPort });
  sockets.add(client);
  sockets.add(upstream);
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.on('close', () => { sockets.delete(client); upstream.destroy(); });
  upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
  client.pipe(upstream);
  upstream.pipe(client);
});
function setPartition(enabled) {
  dropped = enabled;
  if (enabled) for (const socket of [...sockets]) socket.destroy();
}
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) =>
    listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const result = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return result;
}
async function health(port) {
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/healthz',
      { signal: AbortSignal.timeout(6000) });
    return { status: r.status, body: await r.json() };
  } catch { return { status: 0, body: {} }; }
}
async function waitFor(port, expected, seconds = 80) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await health(port);
    if (result.status === expected &&
        result.body.components?.database ===
          (expected === 200 ? 'HEALTHY' : 'DEGRADED')) return;
    await sleep(500);
  }
  throw new Error('MySQL readiness did not reach HTTP ' + expected +
    ' on port ' + port);
}
function startWorker(port, proxyPort, retries = '300,300,300') {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: 'production', VITEST: 'false',
      DB_HOST: '127.0.0.1', DB_PORT: String(proxyPort),
      DB_RETRY_DELAYS: retries, PORT: String(port),
      SETUP_TOKEN: crypto.randomBytes(32).toString('hex'),
      ALLOW_FALLBACK_DB: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', data => { output = (output + data).slice(-2500); });
  }
  child.diagnostics = () => output;
  live.push(child);
  return child;
}
async function enroll(port, hostname, token) {
  const r = await fetch('http://127.0.0.1:' + port + '/api/v1/agent/enroll', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostname, device_uid: hostname + '-UID', bootstrap_token: token
    }), signal: AbortSignal.timeout(12000)
  });
  return { status: r.status, body: await r.json() };
}
function bootstrap() {
  const data = tenantId + ':' + crypto.randomUUID() + ':' +
    (Date.now() + 3600000);
  const signature = crypto.createHmac('sha256', process.env.BOOTSTRAP_SECRET)
    .update(data).digest('hex');
  return Buffer.from(data + ':' + signature).toString('base64url');
}
try {
  await pool.query('SELECT 1');
  await pool.query(fs.readFileSync('database/mysql/schema.sql', 'utf8'));
  schemaReady = true;
  await pool.execute('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)',
    [tenantId, prefix, prefix.toLowerCase()]);
  await pool.execute('INSERT INTO companies (tenant_id, name) VALUES (?, ?)',
    [tenantId, prefix + '-company']);
  await new Promise((resolve, reject) =>
    proxy.once('error', reject).listen(0, '127.0.0.1', resolve));
  listening = true;
  const proxyPort = proxy.address().port;
  const mainPort = await freePort(), peerPort = await freePort(), coldPort = await freePort();
  const main = startWorker(mainPort, proxyPort);
  await waitFor(mainPort, 200, 35);
  const peer = startWorker(peerPort, proxyPort);
  await waitFor(peerPort, 200, 35);
  assert.equal(main.exitCode, null, 'Primary worker exited during startup');
  assert.equal(peer.exitCode, null, 'Peer worker exited during startup');
  console.log('[PASS] Two production workers share isolated MySQL TCP fault proxy.');

  const token = bootstrap(), deviceHost = prefix + '-DEVICE';
  setPartition(true);
  await Promise.all([waitFor(mainPort, 503, 15), waitFor(peerPort, 503, 15)]);
  const rejected = await Promise.all([enroll(mainPort, deviceHost, token), enroll(peerPort, deviceHost, token)]);
  for (const result of rejected) {
    assert.equal(result.status, 503, 'Both API nodes must fail closed during DB partition');
    assert.equal(result.body.error, 'DATABASE_UNAVAILABLE');
  }
  const cold = startWorker(coldPort, proxyPort, '100,100');
  await Promise.race([
    once(cold, 'exit'),
    sleep(15000).then(() => { throw new Error('Cold worker did not terminate without DB'); })
  ]);
  assert.notEqual(cold.exitCode, 0, 'Cold production process started without DB');
  assert.notEqual((await health(coldPort)).status, 200);
  console.log('[PASS] Both hot nodes fail closed with 503; cold worker cannot serve without MySQL.');

  setPartition(false);
  await Promise.all([waitFor(mainPort, 200, 80), waitFor(peerPort, 200, 80)]);
  const accepted = await enroll(mainPort, deviceHost, token);
  assert.equal(accepted.status, 201,
    'Unused bootstrap must succeed after DB recovery: ' + JSON.stringify(accepted.body));
  const replay = await enroll(peerPort, prefix + '-REPLAY', token);
  assert.equal(replay.status, 401, 'Recovered worker allowed replay of a consumed token');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS total FROM used_bootstrap_tokens WHERE token_hash = ?', [hash]);
  assert.equal(Number(rows[0].total), 1);
  console.log('[PASS] Both nodes recover; bootstrap token redeemed on one is rejected as replay on the other.');

  // Phase O: persistent HTTP authentication and real cross-process revocation.
  const username = prefix + '-admin';
  const [user] = await pool.execute(
    'INSERT INTO users (tenant_id, username, email, password_hash, role, active, status) VALUES (?, ?, ?, ?, ?, 1, ?)',
    [tenantId, username, username + '@invalid.example', 'CI-only-no-password-login', 'SUPER_ADMIN', 'ACTIVE']);
  const adminToken = jwt.sign({ id: user.insertId, username, tenant_id: tenantId,
    role: 'SUPER_ADMIN', jti: crypto.randomUUID() }, process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '5m' });
  const deviceId = accepted.body.device_id || accepted.body.id;
  const deviceToken = accepted.body.device_token;
  assert.match(deviceId, /^[0-9a-f-]{36}$/i);
  assert.match(deviceToken, /^itk_dev_[a-f0-9]{48}$/);
  async function poll(port, headers = { 'X-Device-Token': deviceToken }) {
    const r = await fetch('http://127.0.0.1:' + port + '/api/v1/commands/poll?device_id=' + encodeURIComponent(deviceId),
      { headers, signal: AbortSignal.timeout(12000) });
    return { status: r.status, body: await r.json() };
  }
  async function revoke(port, headers, confirm = deviceId) {
    const r = await fetch('http://127.0.0.1:' + port + '/api/v1/devices/' + deviceId + '/credentials/revoke',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ confirm_device_id: confirm, reason_code: 'ADMINISTRATIVE_HOLD' }),
        signal: AbortSignal.timeout(12000) });
    return { status: r.status, body: await r.json() };
  }
  for (const port of [mainPort, peerPort]) {
    assert.equal((await poll(port)).status, 200);
    const otherToken = 'itk_dev_' + crypto.randomBytes(24).toString('hex');
    for (const headers of [
      { 'X-Agent-Token': deviceToken },
      { 'X-Bootstrap-Token': deviceToken },
      { 'X-Device-Token': deviceToken, Authorization: 'Bearer ' + otherToken }
    ]) {
      const denied = await poll(port, headers);
      assert.equal(denied.status, 401, 'Deployed worker accepted legacy or conflicting credentials');
    }
  }
  console.log('[PASS] Both workers reject legacy and conflicting agent credential headers.');
  const auth = { Authorization: 'Bearer ' + adminToken };
  assert.equal((await revoke(mainPort, auth, crypto.randomUUID())).status, 400);
  assert.equal((await revoke(peerPort, { Cookie: 'auth_token=' + adminToken })).status, 403);
  const [before] = await pool.execute('SELECT last_seen_at FROM devices WHERE id = ?', [deviceId]);
  const revocations = await Promise.all([revoke(mainPort, auth), revoke(peerPort, auth)]);
  for (const result of revocations) {
    assert.equal(result.status, 200);
    assert.equal(result.body.credential_revoked, true);
    assert.equal(result.body.device_id, deviceId);
  }
  assert.equal(revocations.filter(r => r.body.already_revoked === false).length, 1);
  assert.equal(revocations.filter(r => r.body.already_revoked === true).length, 1);
  const [after] = await pool.execute('SELECT agent_token_revoked, last_seen_at FROM devices WHERE id = ?', [deviceId]);
  assert.equal(Number(after[0].agent_token_revoked), 1);
  assert.equal(String(after[0].last_seen_at), String(before[0].last_seen_at));
  const [auditRows] = await pool.execute(
    'SELECT COUNT(*) AS total FROM audit_logs WHERE tenant_id = ? AND action = ? AND target_resource = ?',
    [tenantId, 'DEVICE_CREDENTIAL_REVOKED', 'Device:' + deviceId]);
  assert.equal(Number(auditRows[0].total), 1);
  for (const port of [mainPort, peerPort]) {
    const denied = await poll(port);
    // Revocation is an authentication failure, not an RBAC denial.
    // Existing gateway contract: 401 plus the exact typed error.
    assert.equal(denied.status, 401);
    assert.equal(denied.body.error, 'DEVICE_TOKEN_REVOKED');
  }
  console.log('[PASS] Two production workers enforce one durable revocation/audit and deny subsequent agent authentication.');
} finally {
  setPartition(true);
  for (const child of live) child.kill('SIGTERM');
  await Promise.all(live.map(async child => {
    if (child.exitCode !== null || child.signalCode) return;
    await Promise.race([once(child, 'exit').catch(() => {}), sleep(2000)]);
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
  }));
  if (listening) await new Promise(resolve => proxy.close(resolve));
  try {
    if (schemaReady) {
      await pool.query('DELETE FROM audit_logs WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM user_workspace_memberships WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM users WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM used_bootstrap_tokens WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM devices WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM companies WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM tenants WHERE id = ?', [tenantId]);
    }
  } finally {
    await pool.end();
  }
}
