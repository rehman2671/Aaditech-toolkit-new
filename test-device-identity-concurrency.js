#!/usr/bin/env node
/**
 * Phase N Stage 6: real MySQL advisory-lock isolation across independent Node
 * processes (not a mock and not a single-process promise queue).
 *
 * This intentionally exercises the *real* withDeviceIdentityLock implementation
 * against a disposable table on the CI MySQL service. It is not a replacement
 * for a separately controlled, full multi-instance HTTP enrollment rehearsal.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import * as db from './db.js';
import { validateEnrollmentIdentity } from './enrollment-security.js';

const scriptPath = fileURLToPath(import.meta.url);
const table = 'itk_ci_identity_claims';
const tenantA = '00000000-0000-0000-0000-000000000091';
const tenantB = '00000000-0000-0000-0000-000000000092';
const settings = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 4,
  waitForConnections: true
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.env.ITK_IDENTITY_PROBE_WORKER === '1') {
  let pool;
  try {
    if (!process.send) throw new Error('Worker must use an IPC parent');
    pool = mysql.createPool(settings);
    await pool.query('SELECT 1');
    // Each worker has its own db.js module and MySQL connection pool.
    // There is no shared in-memory lock or cache between these processes.
    db.setConnectionStateForTesting(true, pool);
    const { hostname, deviceUid, tenantId, claimId } = JSON.parse(process.env.ITK_IDENTITY_CLAIM);
    const result = await db.withDeviceIdentityLock(hostname, deviceUid, async () => {
      const [rows] = await pool.execute(
        `SELECT id, tenant_id, hostname, device_uid FROM \`${table}\`
         WHERE LOWER(hostname) = LOWER(?) OR LOWER(device_uid) = LOWER(?)`,
        [hostname, deviceUid]
      );
      const existingHost = rows.find(row => row.hostname.toLowerCase() === hostname.toLowerCase()) || null;
      const existingUid = rows.find(row => row.device_uid.toLowerCase() === deviceUid.toLowerCase()) || null;
      const check = validateEnrollmentIdentity({
        tenantId, company: { tenant_id: tenantId },
        existingHost, existingUid, matchingDevices: rows, requestedUid: deviceUid
      });
      // A conflicting tenant always loses. Existing identity also cannot be
      // claimed a second time, even if a second request has the same tenant.
      if (!check.ok || rows.length > 0) return { claimed: false, reason: check.code || 'ALREADY_CLAIMED' };
      // Widen the race window: with missing/disconnected advisory locks,
      // parallel processes will see the empty table before any claim exists.
      await sleep(75);
      await pool.execute(
        `INSERT INTO \`${table}\` (id, tenant_id, hostname, device_uid) VALUES (?, ?, ?, ?)`,
        [claimId, tenantId, hostname, deviceUid]
      );
      return { claimed: true };
    });
    process.send({ type: 'result', ...result });
  } catch (err) {
    process.send?.({ type: 'error', error: err?.message || String(err) });
    process.exitCode = 1;
  } finally {
    db.setConnectionStateForTesting(false, null);
    if (pool) await pool.end();
  }
} else {
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.AADITECH_CONCURRENCY_REHEARSAL !== 'isolated-ci' ||
      process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'it_toolkit') {
    throw new Error('Run only on isolated GitHub Actions test MySQL with AADITECH_CONCURRENCY_REHEARSAL=isolated-ci.');
  }
  if (!settings.user || !settings.password) throw new Error('Explicit test MySQL credentials required.');

  const pool = mysql.createPool(settings);
  const alive = new Set();
  const spawned = claim => new Promise((resolve, reject) => {
    const child = fork(scriptPath, [], {
      env: {
        ...process.env,
        ITK_IDENTITY_PROBE_WORKER: '1',
        ITK_IDENTITY_CLAIM: JSON.stringify({ ...claim, claimId: crypto.randomUUID() })
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    alive.add(child);
    let stderr = '';
    child.stderr?.on('data', data => {
      stderr = (stderr + data.toString()).slice(-2048);
    });
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('Multi-process identity lock worker exceeded 25 seconds'));
    }, 25000);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      alive.delete(child);
      if (error) reject(error);
      else resolve(result);
    }
    child.on('message', message => {
      if (message?.type === 'result') finish(null, { ...claim, ...message });
      if (message?.type === 'error') finish(new Error(message.error));
    });
    child.on('error', error => finish(error));
    child.on('exit', code => {
      if (!settled) finish(new Error(`Worker exited before reporting result (${code}): ${stderr}`));
    });
  });

  try {
    await pool.query('SELECT 1');
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${table}\` (
        id CHAR(36) PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        hostname VARCHAR(160) NOT NULL,
        device_uid VARCHAR(160) NOT NULL,
        UNIQUE KEY uq_claim_hostname (hostname),
        UNIQUE KEY uq_claim_device_uid (device_uid)
      ) ENGINE=InnoDB`
    );
    await pool.query(`DELETE FROM \`${table}\``);
    const prefix = 'CI-' + crypto.randomBytes(5).toString('hex');

    // Same host, different UIDs and tenants: exactly one claim survives.
    const sameHost = await Promise.all(Array.from({ length: 8 }, (_, i) => spawned({
      hostname: prefix + '-SHARED-HOST',
      deviceUid: prefix + '-UID-HOST-' + i,
      tenantId: i % 2 ? tenantA : tenantB
    })));
    assert.equal(sameHost.filter(x => x.claimed).length, 1, 'two tenants claimed the same hostname');
    assert.ok(sameHost.filter(x => !x.claimed).every(x =>
      ['DEVICE_TENANT_CONFLICT', 'DEVICE_UID_CONFLICT', 'ALREADY_CLAIMED'].includes(x.reason)
    ), 'unexpected rejection mechanism for shared host');
    console.log('[PASS] Eight independent Node processes: one hostname owner across tenants.');

    // Same UID, different hostnames, different tenants: same invariant.
    const sameUid = await Promise.all(Array.from({ length: 8 }, (_, i) => spawned({
      hostname: prefix + '-HOST-UID-' + i,
      deviceUid: prefix + '-SHARED-UID',
      tenantId: i % 2 ? tenantB : tenantA
    })));
    assert.equal(sameUid.filter(x => x.claimed).length, 1, 'two tenants claimed the same device UID');
    console.log('[PASS] Eight independent Node processes: one UID owner across tenants.');

    // Unrelated identities must continue to enroll without global denial.
    const independent = await Promise.all(Array.from({ length: 4 }, (_, i) => spawned({
      hostname: prefix + '-FREE-HOST-' + i,
      deviceUid: prefix + '-FREE-UID-' + i,
      tenantId: i % 2 ? tenantA : tenantB
    })));
    assert.equal(independent.filter(x => x.claimed).length, 4, 'unrelated hostnames must not conflict');
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    assert.equal(count.total, 6, 'persistent claim count must equal two winners plus four unrelated devices');
    console.log('[PASS] Four unrelated devices across tenants; MySQL stored exactly six unique claims.');
    console.log('[PASS] Real MySQL multi-process advisory-lock concurrency rehearsal succeeded.');
  } finally {
    for (const child of alive) child.kill();
    try { await pool.query(`DROP TABLE IF EXISTS \`${table}\``); }
    finally { await pool.end(); }
  }
}
