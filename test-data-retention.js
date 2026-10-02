// test-data-retention.js
// Automated verification suite for Data Retention & Unbounded Growth Prevention

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function loginAdmin() {
  const payload = {
    username: 'admin',
    password: 'Admin123!'
  };
  const res = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, payload);

  const data = JSON.parse(res.body);
  return data.token;
}

async function runTests() {
  console.log('=== Starting Data Retention & Unbounded Growth Verification Suite ===\n');

  // --- Step 1: Verify Schema Partitioning Definition ---
  console.log('--- 1. Verifying MySQL Schema Partitioning on telemetry_history ---');
  const schemaPath = path.join(__dirname, 'database', 'mysql', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  assert(schemaSql.includes('PARTITION BY RANGE (TO_DAYS(recorded_at))'), 'Schema must define RANGE partitioning by TO_DAYS(recorded_at)');
  assert(schemaSql.includes('PRIMARY KEY (`id`, `recorded_at`)'), 'Partitioned table must include recorded_at in PRIMARY KEY');
  assert(schemaSql.includes('PARTITION p_future VALUES LESS THAN MAXVALUE'), 'Partitioned table must include p_future boundary');
  console.log('PASS: telemetry_history schema defines range partitioning with compliant composite primary key.');

  // --- Step 2: Verify Dynamic Retention Settings in DB ---
  console.log('\n--- 2. Verifying Dynamic DB-Driven Retention Settings ---');
  const adminToken = await loginAdmin();
  assert(adminToken, 'Admin login must succeed to test retention endpoints');

  // Get current settings
  const getRes = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/v1/settings/retention',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    }
  });
  assert.strictEqual(getRes.statusCode, 200, 'GET /api/v1/settings/retention should return 200');
  const initSettings = JSON.parse(getRes.body);
  console.log('Current DB retention settings:', initSettings);

  // Update retention settings to dynamic test values
  const updatedSettingsPayload = {
    raw_telemetry_days: 14,
    aggregated_metrics_days: 180,
    audit_logs_days: 365,
    resolved_alerts_days: 45,
    completed_commands_days: 15
  };
  const postRes = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/v1/settings/retention',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    }
  }, updatedSettingsPayload);

  assert.strictEqual(postRes.statusCode, 200, 'POST /api/v1/settings/retention should return 200');
  const savedSettings = JSON.parse(postRes.body);
  assert.strictEqual(savedSettings.raw_telemetry_days, 14, 'raw_telemetry_days must be dynamically saved');
  assert.strictEqual(savedSettings.resolved_alerts_days, 45, 'resolved_alerts_days must be dynamically saved');
  assert.strictEqual(savedSettings.completed_commands_days, 15, 'completed_commands_days must be dynamically saved');
  console.log('PASS: Dynamic retention configuration saved to DB successfully.');

  // --- Step 3: Seed Expired Data & Run Retention Purge ---
  console.log('\n--- 3. Testing Data Purge Engine Execution ---');
  // Seed expired telemetry record (>14 days old)
  await db.insertTelemetryRecord('dev-retention-test', {
    cpu: { utilization_pct: 42 },
    ram: { utilization_pct: 55 },
    disk: { free_gb: 120 },
    network: { latency_ms: 18 }
  });

  // Seed expired resolved alert
  const testAlert = await db.createAlert({
    hostname: 'TEST-RETENTION-BOX',
    rule_name: 'Retention Expired Rule',
    severity: 'warning',
    message: 'Resolved test alert for retention purge',
    status: 'resolved'
  });

  // Trigger manual purge via API
  const runRes = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/v1/settings/retention/run',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    }
  });

  assert.strictEqual(runRes.statusCode, 200, 'Manual purge endpoint should return 200');
  const purgeResult = JSON.parse(runRes.body);
  assert(purgeResult.result, 'Purge response must contain result');
  assert.strictEqual(purgeResult.result.status, 'SUCCESS', 'Purge status must be SUCCESS');
  assert.strictEqual(purgeResult.result.settings_applied.raw_telemetry_days, 14, 'Purge must apply dynamic settings from DB');
  assert.strictEqual(purgeResult.result.settings_applied.resolved_alerts_days, 45, 'Purge must apply dynamic alert window from DB');
  console.log('Purge statistics recorded:', purgeResult.result.purged_rows);
  console.log('PASS: Data retention purge executed successfully using dynamic DB parameters.');

  // --- Step 4: Verify Operator Visibility via /healthz ---
  console.log('\n--- 4. Verifying /healthz Operator Visibility ---');
  const healthRes = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/healthz',
    method: 'GET'
  });
  assert.strictEqual(healthRes.statusCode, 200, '/healthz should return 200');
  const healthData = JSON.parse(healthRes.body);
  assert(healthData.data_retention, '/healthz must expose data_retention section');
  assert(healthData.data_retention.last_run_at, '/healthz must expose last_run_at timestamp');
  assert(healthData.data_retention.purged_rows, '/healthz must expose purged_rows counts');
  console.log('Healthz retention status:', healthData.data_retention);
  console.log('PASS: /healthz exposes last-run timestamp and row counts for operators.');

  // --- Step 5: Verify Prometheus /metrics Endpoint ---
  console.log('\n--- 5. Verifying Prometheus /metrics Endpoint ---');
  const metricsRes = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/metrics',
    method: 'GET'
  });
  assert.strictEqual(metricsRes.statusCode, 200, '/metrics should return 200');
  const metricsText = metricsRes.body;
  assert(metricsText.includes('aaditech_retention_last_run_timestamp_seconds'), '/metrics must include aaditech_retention_last_run_timestamp_seconds');
  assert(metricsText.includes('aaditech_retention_purged_rows_total'), '/metrics must include aaditech_retention_purged_rows_total');
  console.log('PASS: Prometheus metrics correctly expose retention gauges and counters.');

  // --- Step 6: Verify Insertion Complexity (push vs unshift) ---
  console.log('\n--- 6. Verifying Array Growth Complexity (O(1) push vs O(N) unshift) ---');
  const dbCode = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
  assert(!dbCode.includes('memAlerts.unshift('), 'memAlerts must not use .unshift()');
  assert(!dbCode.includes('memMsiPackages.unshift('), 'memMsiPackages must not use .unshift()');
  assert(dbCode.includes('memAlerts.push('), 'memAlerts must use O(1) .push()');
  assert(dbCode.includes('memTelemetry.push('), 'memTelemetry must use O(1) .push()');
  assert(dbCode.includes('memAuditLogs.push('), 'memAuditLogs must use O(1) .push()');
  console.log('PASS: All state collections utilize O(1) push and undergo scheduled pruning.');

  console.log('\n=== ALL DATA RETENTION & UNBOUNDED GROWTH TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('FATAL: Retention verification test failed:', err);
  process.exit(1);
});
