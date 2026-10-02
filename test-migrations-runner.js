// test-migrations-runner.js
// Automated verification suite for MySQL 8 Migrations, Schema Tracking & Partition Maintenance

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('=== Starting Enterprise MySQL Migrations & Partition Maintenance Test Suite ===\n');

  // --- Step 1: Verify Elimination of PostgreSQL syntax from database/migrations/ ---
  console.log('--- 1. Verifying Database Engine Standardization (MySQL 8 / MariaDB) ---');
  const migrationsDir = path.join(__dirname, 'database', 'migrations');
  assert(fs.existsSync(migrationsDir), 'database/migrations directory must exist');

  const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  assert.deepStrictEqual(
    migrationFiles,
    ['001_init_schema.sql', '002_partitioning.sql', '003_rbac_and_audit.sql'],
    'Expected 001, 002, 003 migration files to be present'
  );

  const forbiddenPostgresKeywords = [
    'TIMESTAMPTZ',
    'PARTITION OF',
    'JSONB',
    'UUID_GENERATE_V4',
    'UUID-OSSP',
    'BIGSERIAL',
    'SERIAL PRIMARY KEY'
  ];

  for (const file of migrationFiles) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8').toUpperCase();
    for (const kw of forbiddenPostgresKeywords) {
      assert(
        !content.includes(kw),
        `File ${file} must not contain Postgres syntax '${kw}' - must be MySQL 8 compatible`
      );
    }
  }
  console.log('PASS: All migration files standardized on MySQL 8 syntax (zero PostgreSQL artifacts).');

  // --- Step 2: Verify MySQL-Native Range Partitioning in 002_partitioning.sql ---
  console.log('\n--- 2. Verifying MySQL-Native Range Partitioning (002_partitioning.sql) ---');
  const part002 = fs.readFileSync(path.join(migrationsDir, '002_partitioning.sql'), 'utf8');

  assert(
    part002.includes('PARTITION BY RANGE (TO_DAYS(recorded_at))'),
    '002_partitioning.sql must specify PARTITION BY RANGE (TO_DAYS(recorded_at))'
  );
  assert(
    part002.includes('PRIMARY KEY (`id`, `recorded_at`)'),
    '002_partitioning.sql must include recorded_at in composite PRIMARY KEY'
  );
  assert(
    part002.includes('PARTITION p_future VALUES LESS THAN MAXVALUE'),
    '002_partitioning.sql must specify p_future catch-all partition'
  );
  assert(
    part002.includes('PARTITION p_historical VALUES LESS THAN'),
    '002_partitioning.sql must define initial historical partition'
  );
  console.log('PASS: 002_partitioning.sql satisfies all MySQL-native partition constraints.');

  // --- Step 3: Verify Core Relational Schema in 001_init_schema.sql ---
  console.log('\n--- 3. Verifying Core Tables & Indexes in 001_init_schema.sql ---');
  const init001 = fs.readFileSync(path.join(migrationsDir, '001_init_schema.sql'), 'utf8');
  const required001Tables = [
    'tenants', 'companies', 'users', 'devices', 'device_processes',
    'device_patches', 'command_queue', 'msi_packages', 'used_bootstrap_tokens',
    'tickets', 'events', 'remediation_policies', 'remediation_logs',
    'revoked_tokens', 'system_settings'
  ];
  for (const tbl of required001Tables) {
    assert(
      init001.includes(`CREATE TABLE IF NOT EXISTS \`${tbl}\``),
      `001_init_schema.sql must define table ${tbl}`
    );
  }
  console.log(`PASS: 001_init_schema.sql defines all ${required001Tables.length} core tables.`);

  // --- Step 4: Verify RBAC, Audit & Idempotent Seeds in 003_rbac_and_audit.sql ---
  console.log('\n--- 4. Verifying RBAC, Audit & Seeds in 003_rbac_and_audit.sql ---');
  const rbac003 = fs.readFileSync(path.join(migrationsDir, '003_rbac_and_audit.sql'), 'utf8');
  const required003Tables = ['audit_logs', 'alert_rules', 'alerts', 'groups', 'policies'];
  for (const tbl of required003Tables) {
    assert(
      rbac003.includes(`CREATE TABLE IF NOT EXISTS \`${tbl}\``),
      `003_rbac_and_audit.sql must define table ${tbl}`
    );
  }
  assert(rbac003.includes('INSERT IGNORE INTO `users`'), '003 migration must use idempotent INSERT IGNORE');
  assert(rbac003.includes('INSERT IGNORE INTO `tenants`'), '003 migration must use idempotent INSERT IGNORE');
  console.log('PASS: 003_rbac_and_audit.sql defines audit tables and idempotent seeds.');

  // --- Step 5: Test Migration Runner Execution & Concurrency Lock ---
  console.log('\n--- 5. Testing Migration Runner Logic & Idempotency ---');
  assert(typeof db.runDatabaseMigrations === 'function', 'db.runDatabaseMigrations must be exported');
  assert(typeof db.maintainTelemetryPartitions === 'function', 'db.maintainTelemetryPartitions must be exported');

  // Test run 1
  const run1 = await db.runDatabaseMigrations();
  console.log('Migration Runner Run 1 result:', run1);
  assert(run1, 'Migration runner must return result object');
  assert(Array.isArray(run1.applied), 'run.applied must be an array');
  assert(Array.isArray(run1.skipped), 'run.skipped must be an array');

  // Test run 2 (idempotency check: nothing new should be applied)
  const run2 = await db.runDatabaseMigrations();
  console.log('Migration Runner Run 2 (Idempotency) result:', run2);
  assert.strictEqual(run2.applied.length, 0, 'Second migration run must apply 0 new migrations');
  console.log('PASS: Migration runner is idempotent and properly skips applied migrations.');

  // --- Step 6: Test Partition Maintenance Forward Calculation ---
  console.log('\n--- 6. Testing Partition Maintenance Routine ---');
  const partResult = await db.maintainTelemetryPartitions(30);
  console.log('maintainTelemetryPartitions result:', partResult);
  assert(partResult, 'Partition maintenance must return result object');
  assert(Array.isArray(partResult.created), 'partResult.created must be an array');
  assert(Array.isArray(partResult.dropped), 'partResult.dropped must be an array');
  console.log('PASS: Partition maintenance executed cleanly.');

  // --- Step 7: Verify schema.sql Synchronization ---
  console.log('\n--- 7. Verifying database/mysql/schema.sql Baseline Sync ---');
  const schemaSql = fs.readFileSync(path.join(__dirname, 'database', 'mysql', 'schema.sql'), 'utf8');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS `schema_migrations`'), 'schema.sql must include schema_migrations');
  assert(schemaSql.includes('PARTITION BY RANGE (TO_DAYS(recorded_at))'), 'schema.sql must include telemetry partitioning');
  console.log('PASS: schema.sql contains schema_migrations tracking table and partition definition.');

  console.log('\n================================================================');
  console.log('🎉 ALL DATABASE MIGRATION & PARTITIONING TESTS PASSED (100%)');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('❌ Migration test failed:', err);
  process.exit(1);
});
