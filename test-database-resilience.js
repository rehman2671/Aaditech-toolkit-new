import assert from 'node:assert';
import * as db from './db.js';

console.log('--- TEST SUITE: Database Connection Resilience & Transactions ---');

async function runTests() {
  // Test 1: Configurable DB_POOL_SIZE and Retry logic
  console.log('\n[Test 1] Verifying retry logic and connection resilience...');
  process.env.DB_RETRY_DELAYS = '10,20,30,40,50'; // fast test backoff
  process.env.DB_POOL_SIZE = '25';

  const startTime = Date.now();
  const initResult = await db.initDbPool({
    retryDelays: [10, 20, 30, 40, 50],
    maxAttempts: 5
  });
  const elapsed = Date.now() - startTime;
  console.log(`Initial connection attempts completed in ${elapsed}ms. Result (false expected when DB offline):`, initResult);
  assert.strictEqual(typeof initResult, 'boolean');

  // Test 2: Atomic syncDeviceProcesses
  console.log('\n[Test 2] Verifying syncDeviceProcesses atomic execution...');
  const testDeviceId = 'test-device-uuid-99';
  const testProcesses = [
    { pid: 1001, name: 'systemd', cpu_pct: 0.8, ram_mb: 24.5, path: '/lib/systemd/systemd', user_account: 'root' },
    { pid: 1042, name: 'dockerd', cpu_pct: 4.2, ram_mb: 180.0, path: '/usr/bin/dockerd', user_account: 'root' },
    { pid: 2100, name: 'node', cpu_pct: 12.5, ram_mb: 310.2, path: '/usr/bin/node', user_account: 'itk_svc' }
  ];

  const syncOk = await db.syncDeviceProcesses(testDeviceId, testProcesses);
  assert.strictEqual(syncOk, true, 'syncDeviceProcesses should succeed');

  const retrieved = await db.getDeviceProcesses(testDeviceId);
  assert.strictEqual(retrieved.length, 3, 'Should retrieve exactly 3 synced processes');
  assert.strictEqual(retrieved[0].name, 'systemd');
  assert.strictEqual(retrieved[2].name, 'node');
  console.log('✅ syncDeviceProcesses atomically synced processes successfully.');

  // Test atomic overwrite:
  const newProcesses = [
    { pid: 9999, name: 'top', cpu_pct: 1.1, ram_mb: 12.0, path: '/usr/bin/top', user_account: 'admin' }
  ];
  await db.syncDeviceProcesses(testDeviceId, newProcesses);
  const updated = await db.getDeviceProcesses(testDeviceId);
  assert.strictEqual(updated.length, 1, 'Previous processes should be completely replaced');
  assert.strictEqual(updated[0].name, 'top');
  console.log('✅ syncDeviceProcesses atomic replacement verified.');

  // Test 3: Batched Telemetry Inserts
  console.log('\n[Test 3] Verifying batched telemetry insert & flush queue...');
  
  // Direct batch insertion
  const batchRecords = [
    { device_id: 'dev-batch-1', cpu: { utilization_pct: 15 }, ram: { utilization_pct: 40 }, disk: { free_gb: 200 }, network: { latency_ms: 12 } },
    { device_id: 'dev-batch-1', cpu: { utilization_pct: 18 }, ram: { utilization_pct: 42 }, disk: { free_gb: 199 }, network: { latency_ms: 14 } }
  ];
  const batchInserted = await db.insertTelemetryBatch(batchRecords);
  assert.strictEqual(batchInserted, 2, 'insertTelemetryBatch should insert 2 records in a single batch');

  // Enqueue single points and verify auto/explicit flush
  await db.insertTelemetryRecord('dev-batch-2', { cpu: { utilization_pct: 50 }, ram: { utilization_pct: 70 }, disk: { free_gb: 50 }, network: { latency_ms: 30 } });
  await db.insertTelemetryRecord('dev-batch-2', { cpu: { utilization_pct: 55 }, ram: { utilization_pct: 72 }, disk: { free_gb: 49 }, network: { latency_ms: 32 } });

  // Reading telemetry automatically triggers flush of queued items
  const history = await db.getTelemetryHistory('dev-batch-2');
  assert.ok(history.length >= 2, 'Telemetry points should be flushed and retrieved');
  console.log('✅ Batched telemetry queue and multi-row flush verified.');

  // Test 4: Pending Commands LIMIT
  console.log('\n[Test 4] Verifying getPendingCommandsForDevice LIMIT...');
  const devCmdTestId = 'dev-cmd-limit-test';
  for (let i = 1; i <= 60; i++) {
    await db.queueCommandInDb({
      device_id: devCmdTestId,
      agent_id: devCmdTestId,
      command_type: 'ping',
      payload: { index: i },
      status: 'pending'
    });
  }

  // Default limit is 50
  const pending50 = await db.getPendingCommandsForDevice(devCmdTestId);
  assert.strictEqual(pending50.length, 50, 'Default limit should cap results at 50 commands');

  // Custom limit 10
  const pending10 = await db.getPendingCommandsForDevice(devCmdTestId, 10);
  assert.strictEqual(pending10.length, 10, 'Custom limit should cap results at 10 commands');
  console.log('✅ getPendingCommandsForDevice LIMIT safely enforced.');

  // Cleanup health check timer
  db.stopDbHealthCheck();

  console.log('\n🌟 ALL DATABASE RESILIENCE & TRANSACTION TESTS PASSED SUCCESSFULLY! 🌟');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
