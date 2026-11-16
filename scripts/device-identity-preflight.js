#!/usr/bin/env node
// Stage 8: read-only MySQL identity preflight. Never prints device identifiers.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const allowedTables = new Set(['devices', 'itk_ci_identity_preflight']);
export async function auditDeviceIdentities(connection, table = 'devices') {
  if (!allowedTables.has(table)) throw new Error('Identity table not allowed');
  const t = String.fromCharCode(96) + table + String.fromCharCode(96);
  const scalar = async sql => {
    const [[row]] = await connection.query(sql);
    return Number(row.total);
  };
  const audit = {
    missingIdentity: await scalar("SELECT COUNT(*) AS total FROM " + t +
      " WHERE tenant_id IS NULL OR TRIM(tenant_id) = '' OR hostname IS NULL OR TRIM(hostname) = ''" +
      " OR device_uid IS NULL OR TRIM(device_uid) = ''"),
    unnormalizedIdentity: await scalar("SELECT COUNT(*) AS total FROM " + t +
      " WHERE (hostname IS NOT NULL AND BINARY hostname <> BINARY TRIM(hostname))" +
      " OR (device_uid IS NOT NULL AND BINARY device_uid <> BINARY TRIM(device_uid))"),
    hostnameCollisionGroups: await scalar("SELECT COUNT(*) AS total FROM (" +
      "SELECT LOWER(TRIM(hostname)) AS k FROM " + t +
      " WHERE hostname IS NOT NULL AND TRIM(hostname) <> ''" +
      " GROUP BY LOWER(TRIM(hostname)) HAVING COUNT(*) > 1) c"),
    uidCollisionGroups: await scalar("SELECT COUNT(*) AS total FROM (" +
      "SELECT LOWER(TRIM(device_uid)) AS k FROM " + t +
      " WHERE device_uid IS NOT NULL AND TRIM(device_uid) <> ''" +
      " GROUP BY LOWER(TRIM(device_uid)) HAVING COUNT(*) > 1) c"),
    crossTenantHostnameGroups: await scalar("SELECT COUNT(*) AS total FROM (" +
      "SELECT LOWER(TRIM(hostname)) AS k FROM " + t +
      " WHERE hostname IS NOT NULL AND TRIM(hostname) <> ''" +
      " GROUP BY LOWER(TRIM(hostname)) HAVING COUNT(DISTINCT tenant_id) > 1) c"),
    crossTenantUidGroups: await scalar("SELECT COUNT(*) AS total FROM (" +
      "SELECT LOWER(TRIM(device_uid)) AS k FROM " + t +
      " WHERE device_uid IS NOT NULL AND TRIM(device_uid) <> ''" +
      " GROUP BY LOWER(TRIM(device_uid)) HAVING COUNT(DISTINCT tenant_id) > 1) c")
  };
  if (table === 'devices') {
    audit.orphanTenantRecords = await scalar(
      'SELECT COUNT(*) AS total FROM devices d LEFT JOIN tenants t ON t.id=d.tenant_id WHERE t.id IS NULL');
  }
  return audit;
}
export const auditIsClean = audit => Object.values(audit).every(n => n === 0);
async function indexesPresent(connection) {
  const [rows] = await connection.query(
    "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX FROM information_schema.STATISTICS" +
    " WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='devices' AND" +
    " INDEX_NAME IN ('uq_devices_global_hostname','uq_devices_global_uid')"
  );
  return [
    ['uq_devices_global_hostname', 'hostname'],
    ['uq_devices_global_uid', 'device_uid']
  ].every(([name, column]) => {
    const matches = rows.filter(r => r.INDEX_NAME === name);
    return matches.length === 1 && matches[0].COLUMN_NAME === column &&
      Number(matches[0].NON_UNIQUE) === 0 && Number(matches[0].SEQ_IN_INDEX) === 1;
  });
}
async function fixtureCheck(connection) {
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.AADITECH_IDENTITY_PREFLIGHT !== 'isolated-ci' ||
      process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'it_toolkit') {
    throw new Error('CI-only synthetic identity fixtures refused');
  }
  await connection.query(
    'CREATE TEMPORARY TABLE itk_ci_identity_preflight (' +
    'id CHAR(36) PRIMARY KEY, tenant_id CHAR(36), hostname VARCHAR(128), device_uid VARCHAR(128)' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
  try {
    assert.ok(auditIsClean(await auditDeviceIdentities(connection, 'itk_ci_identity_preflight')));
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    const rows = [
      [crypto.randomUUID(), a, 'CI-HOST', 'ci-uid-one'],
      [crypto.randomUUID(), b, 'ci-host', 'ci-uid-two'],
      [crypto.randomUUID(), a, 'CI-OTHER', 'CI-UID-TWO'],
      [crypto.randomUUID(), a, ' ', null]
    ];
    for (const row of rows) {
      await connection.execute(
        'INSERT INTO itk_ci_identity_preflight (id, tenant_id, hostname, device_uid) VALUES (?,?,?,?)', row);
    }
    const audit = await auditDeviceIdentities(connection, 'itk_ci_identity_preflight');
    assert.equal(audit.hostnameCollisionGroups, 1);
    assert.equal(audit.uidCollisionGroups, 1);
    assert.equal(audit.crossTenantHostnameGroups, 1);
    assert.equal(audit.crossTenantUidGroups, 1);
    assert.equal(audit.missingIdentity, 1);
    assert.equal(auditIsClean(audit), false);
    console.log('[PASS] Cross-tenant casefold collisions and missing identity block migration.');
  } finally {
    await connection.query('DROP TEMPORARY TABLE IF EXISTS itk_ci_identity_preflight');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  if ([...args].some(a => !['--audit','--require-indexes','--ci-fixtures'].includes(a))) {
    throw new Error('Usage: node scripts/device-identity-preflight.js [--audit] [--require-indexes] [--ci-fixtures]');
  }
  for (const name of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!process.env[name]) throw new Error('Explicit ' + name + ' required');
  }
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectTimeout: 8000
  });
  try {
    if (args.has('--ci-fixtures')) {
      await fixtureCheck(connection);
    } else {
      const audit = await auditDeviceIdentities(connection);
      console.log('Identity collision counts only:', JSON.stringify(audit));
      const indexes = await indexesPresent(connection);
      console.log('Global unique indexes installed:', indexes);
      if (!auditIsClean(audit) || (args.has('--require-indexes') && !indexes)) {
        process.exitCode = 2;
        console.error('[BLOCKED] No migration performed; resolve anomalies with approved change control.');
      } else {
        console.log('[PASS] Read-only identity preflight completed.');
      }
    }
  } finally {
    await connection.end();
  }
}
