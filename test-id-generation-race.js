// Verification test suite for ID Generation & Race Conditions fix
import http from 'http';
import crypto from 'crypto';
import * as db from './db.js';

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 10000
    };

    const req = http.request(url, reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (e) {
          json = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (options.body) {
      const data = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.setHeader('Content-Length', Buffer.byteLength(data));
      if (!req.getHeader('Content-Type')) {
        req.setHeader('Content-Type', 'application/json');
      }
      req.write(data);
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

async function runTests() {
  console.log('=== Starting ID Generation & Race Condition Verification Tests ===');
  await db.initDbPool();

  // 1. Authenticate as Admin
  const loginRes = await makeRequest('/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin123!' }
  });
  assert(loginRes.status === 200, 'Admin login succeeded');
  const token = loginRes.body.token;
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 2. Test Concurrent Device Registrations
  console.log('Testing concurrent device registrations...');
  const devPromises = [];
  const count = 10;
  for (let i = 0; i < count; i++) {
    const uniqueHost = `RACE-NODE-${Date.now()}-${i}-${crypto.randomBytes(4).toString('hex')}`;
    devPromises.push(
      makeRequest('/api/v1/devices', {
        method: 'POST',
        headers: authHeaders,
        body: {
          hostname: uniqueHost,
          os_type: 'WINDOWS',
          os_version: 'Windows 11 Pro',
          agent_version: '1.1.2'
        }
      })
    );
  }
  const devResults = await Promise.all(devPromises);
  const createdDeviceIds = new Set();
  for (const res of devResults) {
    assert(res.status === 201, `Device registration returned 201 (got ${res.status})`);
    if (!res.body?.id) console.log('Device res.body was:', res.body);
    assert(res.body && res.body.id, 'Created device has an ID');
    assert(!createdDeviceIds.has(res.body.id), `Device ID is globally unique (duplicate: ${res.body.id})`);
    // Assert ID is not like '1', '2', etc. based on array length
    assert(typeof res.body.id === 'string' && res.body.id.length >= 10, 'Device ID is a valid high-entropy UUID');
    createdDeviceIds.add(res.body.id);
  }
  assert(createdDeviceIds.size === count, `All ${count} concurrent devices received distinct unique IDs`);

  // 3. Test Concurrent Ticket Creation & Post-Deletion Uniqueness
  console.log('Testing concurrent ticket creation...');
  const ticketPromises = [];
  for (let i = 0; i < count; i++) {
    ticketPromises.push(
      makeRequest('/api/tickets/create', {
        method: 'POST',
        headers: authHeaders,
        body: {
          title: `Concurrent Ticket Test ${i}`,
          agent: 'RACE-NODE-01',
          severity: 'High'
        }
      })
    );
  }
  const ticketResults = await Promise.all(ticketPromises);
  const createdTicketIds = new Set();
  for (const res of ticketResults) {
    assert(res.status === 200, `Ticket creation returned 200 (got ${res.status})`);
    assert(res.body && res.body.ticket && res.body.ticket.id, 'Created ticket has an ID');
    assert(!createdTicketIds.has(res.body.ticket.id), `Ticket ID is globally unique (duplicate: ${res.body.ticket.id})`);
    assert(res.body.ticket.id.includes('-') && res.body.ticket.id.length > 20, 'Ticket ID uses UUID rather than sequential array length');
    createdTicketIds.add(res.body.ticket.id);
  }
  assert(createdTicketIds.size === count, `All ${count} concurrent tickets received distinct unique IDs`);

  // 4. Test Concurrent Command Dispatching
  console.log('Testing concurrent command dispatching...');
  const firstDevId = Array.from(createdDeviceIds)[0];
  const cmdPromises = [];
  for (let i = 0; i < count; i++) {
    cmdPromises.push(
      makeRequest('/api/v1/commands/dispatch', {
        method: 'POST',
        headers: authHeaders,
        body: {
          device_id: firstDevId,
          command_type: 'powershell',
          payload: { script: `Get-Process | Select -First ${i + 1}` }
        }
      })
    );
  }
  const cmdResults = await Promise.all(cmdPromises);
  const createdCmdIds = new Set();
  for (const res of cmdResults) {
    assert(res.status === 201, `Command dispatch returned 201 (got ${res.status})`);
    assert(res.body && res.body.id, 'Command has id');
    assert(!createdCmdIds.has(res.body.id), `Command ID is globally unique (duplicate: ${res.body.id})`);
    assert(typeof res.body.id === 'string' && res.body.id.length >= 32, 'Command ID is a valid UUID');
    createdCmdIds.add(res.body.id);
  }
  assert(createdCmdIds.size === count, `All ${count} concurrent commands received distinct unique IDs`);

  // 5. Test Concurrent Alert Creation in Database
  console.log('Testing concurrent alert generation...');
  const alertPromises = [];
  for (let i = 0; i < count; i++) {
    alertPromises.push(
      db.createAlert({
        device_id: firstDevId,
        hostname: 'RACE-NODE-01',
        rule_name: `Concurrent Rule ${i}`,
        severity: 'critical',
        message: `High CPU warning ${i}`
      })
    );
  }
  const alertResults = await Promise.all(alertPromises);
  const createdAlertIds = new Set();
  for (const alt of alertResults) {
    assert(alt && alt.id, 'Alert returned DB generated primary key ID');
    assert(!createdAlertIds.has(alt.id), `Alert ID is distinct (duplicate: ${alt.id})`);
    createdAlertIds.add(alt.id);
  }
  assert(createdAlertIds.size === count, `All ${count} concurrent alerts received unique DB primary keys`);

  // 6. Test Concurrent Alert Rules, Groups, and Policies
  console.log('Testing concurrent rules, groups, and policies...');
  const rulePromises = [];
  const groupPromises = [];
  const policyPromises = [];
  for (let i = 0; i < 5; i++) {
    rulePromises.push(
      db.createAlertRule({
        name: `Race Rule ${Date.now()}-${i}`,
        metric: 'ram',
        threshold: 85
      })
    );
    groupPromises.push(
      db.createGroup({
        name: `Race Group ${Date.now()}-${i}`,
        description: 'Test Group'
      })
    );
    policyPromises.push(
      db.createPolicy({
        name: `Race Policy ${Date.now()}-${i}`,
        checkin_interval_sec: 45
      })
    );
  }
  const [rules, groups, policies] = await Promise.all([
    Promise.all(rulePromises),
    Promise.all(groupPromises),
    Promise.all(policyPromises)
  ]);

  const ruleIds = new Set(rules.map(r => r.id));
  const groupIds = new Set(groups.map(g => g.id));
  const policyIds = new Set(policies.map(p => p.id));

  assert(ruleIds.size === 5, 'All 5 alert rules have unique UUID-based IDs');
  assert(groupIds.size === 5, 'All 5 groups have unique UUID-based IDs');
  assert(policyIds.size === 5, 'All 5 policies have unique UUID-based IDs');

  // 7. Verify that deletion of an alert or ticket does not cause collision on subsequent creates
  console.log('Testing post-deletion ID generation behavior...');
  const alertsList = await db.getAlerts();
  const alertToDelete = alertsList[0];
  await db.resolveAlert(alertToDelete.id);

  const nextAlert = await db.createAlert({
    device_id: firstDevId,
    hostname: 'RACE-NODE-01',
    rule_name: 'Post Delete Rule',
    severity: 'warning',
    message: 'Testing ID generation after resolution/deletion'
  });
  assert(nextAlert.id !== alertToDelete.id, `New alert ID (${nextAlert.id}) does not collide with previous alert ID (${alertToDelete.id})`);
  assert(nextAlert.id > alertToDelete.id, 'New alert uses monotonic DB auto_increment');

  console.log('=== All ID Generation & Race Condition Verification Tests PASSED ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
