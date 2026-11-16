#!/usr/bin/env node
/**
 * Phase N Stage 9 — destructive DDL rehearsal on a uniquely named CI-only
 * copy of the authoritative devices schema. NEVER alters production devices.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import mysql from 'mysql2/promise';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.AADITECH_IDENTITY_MIGRATION !== 'isolated-ci' ||
    process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'it_toolkit') {
  throw new Error('Refusing identity DDL rehearsal outside isolated GitHub CI MySQL.');
}
for (const name of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
  if (!process.env[name]) throw new Error('Explicit CI database config required: ' + name);
}
const connection = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, connectTimeout: 8000
});
const table = 'itk_ci_identity_ddl_' + crypto.randomBytes(7).toString('hex');
const quoted = String.fromCharCode(96) + table + String.fromCharCode(96);
const id = () => crypto.randomUUID();
const tenantA = id(), tenantB = id();

function migrationSQL() {
  const raw = fs.readFileSync('Enterprise/deploy/migrations/2026-11-global-identity-unique.sql', 'utf8');
  const sql = raw.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim();
  if (!/^ALTER TABLE devices\s+ADD UNIQUE KEY uq_devices_global_hostname \(hostname\),\s+ADD UNIQUE KEY uq_devices_global_uid \(device_uid\);$/i.test(sql)) {
    throw new Error('Identity migration statement has changed; update controlled rehearsal first.');
  }
  return sql.replace(/^ALTER TABLE devices/i, 'ALTER TABLE ' + quoted);
}
async function insert(hostname, uid, tenantId) {
  return connection.execute(
    'INSERT INTO ' + quoted + ' (id, tenant_id, hostname, device_uid) VALUES (?, ?, ?, ?)',
    [id(), tenantId, hostname, uid]
  );
}
async function uniqueIndexes() {
  const [rows] = await connection.execute(
    'SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS ' +
    'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME IN (?, ?)',
    [table, 'uq_devices_global_hostname', 'uq_devices_global_uid']
  );
  return rows.filter(row => Number(row.NON_UNIQUE) === 0).map(row => row.INDEX_NAME).sort();
}
async function requireDuplicate(promise, description) {
  await assert.rejects(promise, error => error.code === 'ER_DUP_ENTRY', description);
}
try {
  // Tests operate only on a unique disposable copy, not the real devices table.
  await connection.query('CREATE TABLE ' + quoted + ' LIKE devices');
  await insert('STAGE9-COLLIDE', 'STAGE9-UID-A', tenantA);
  await insert('stage9-collide', 'STAGE9-UID-B', tenantB);
  await requireDuplicate(connection.query(migrationSQL()), 'Legacy cross-tenant duplicate must block DDL.');
  assert.deepEqual(await uniqueIndexes(), [], 'Failed DDL must not partly create unique indexes.');
  console.log('[PASS] Legacy case-insensitive hostname collision blocks global index migration.');

  await connection.query('DELETE FROM ' + quoted);
  await insert('STAGE9-HOST-A', 'STAGE9-UID-A', tenantA);
  await insert('STAGE9-HOST-B', 'STAGE9-UID-B', tenantB);
  await connection.query(migrationSQL());
  assert.deepEqual(await uniqueIndexes(), [
    'uq_devices_global_hostname', 'uq_devices_global_uid'
  ]);
  console.log('[PASS] Exactly the approved two-index SQL migrates a clean copy atomically.');

  await requireDuplicate(insert('stage9-host-a', 'STAGE9-UID-NEW', tenantB),
    'Different tenant must not claim an existing hostname with different casing.');
  await requireDuplicate(insert('STAGE9-HOST-NEW', 'stage9-uid-b', tenantA),
    'Different tenant must not claim an existing UID with different casing.');
  await insert('STAGE9-HOST-C', 'STAGE9-UID-C', tenantB);
  const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM ' + quoted);
  assert.equal(Number(count.total), 3);
  console.log('[PASS] DB rejects cross-tenant hostname/UID collisions and allows unrelated devices.');
} finally {
  try { await connection.query('DROP TABLE IF EXISTS ' + quoted); }
  finally { await connection.end(); }
}
