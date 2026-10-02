// Comprehensive verification test for Agent & Device Authentication Subsystem
import http from 'http';
import crypto from 'crypto';
import { spawn } from 'child_process';

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 5000
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
  console.log('=== Starting Device & Agent Security Posture Tests ===');

  // 1. Admin login to obtain admin JWT
  const loginRes = await makeRequest('/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin123!' }
  });
  assert(loginRes.status === 200, 'Admin can login with valid credentials');
  const adminToken = loginRes.body.token;

  // 2. Generate MSI package with bootstrap token
  const msiRes = await makeRequest('/api/v1/msi/generate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { package_name: 'Test-Security-Bundle', version: '2.5.0', bootstrap_expiry_hours: 2 }
  });
  assert(msiRes.status === 201, 'MSI package generated with bootstrap token');
  const bootstrapToken = msiRes.body.bootstrap_token;
  assert(!!bootstrapToken, 'Bootstrap token generated successfully');

  // 3. Device Enrollment using bootstrap token
  const testHostA = 'SECURITY-AGENT-ALPHA';
  const enrollRes = await makeRequest('/api/v1/agent/enroll', {
    method: 'POST',
    headers: { 'X-Bootstrap-Token': bootstrapToken },
    body: { hostname: testHostA, os_version: 'Windows 11 Enterprise' }
  });
  assert(enrollRes.status === 201, 'Device successfully enrolled with bootstrap token');
  assert(enrollRes.body.status === 'enrolled', 'Enrollment status is enrolled');
  const deviceTokenA = enrollRes.body.device_token;
  assert(deviceTokenA && deviceTokenA.startsWith('itk_dev_'), 'Device issued unique per-device token starting with itk_dev_');

  // 4. Test Single-Use Enforcement: Second attempt with same bootstrap token MUST fail
  const replayEnrollRes = await makeRequest('/api/v1/agent/enroll', {
    method: 'POST',
    headers: { 'X-Bootstrap-Token': bootstrapToken },
    body: { hostname: 'ROGUE-IMPERSONATOR-01' }
  });
  assert(replayEnrollRes.status === 401, 'Bootstrap token reuse rejected with 401 Unauthorized');
  assert(replayEnrollRes.body.detail.includes('single-use') || replayEnrollRes.body.detail.includes('already been used'), 'Replay error explicitly identifies token has already been consumed');

  // 5. Test Expired Bootstrap Token
  const expiredPayload = `00000000-0000-0000-0000-000000000001:default:${Date.now() - 3600000}`;
  const bootstrapSecret = process.env.BOOTSTRAP_SECRET || 'aaditech_master_bootstrap_secret_key_2026_prod';
  const expiredSig = crypto.createHmac('sha256', bootstrapSecret).update(expiredPayload).digest('hex');
  const expiredToken = Buffer.from(`${expiredPayload}:${expiredSig}`).toString('base64url');

  const expiredEnrollRes = await makeRequest('/api/v1/agent/enroll', {
    method: 'POST',
    headers: { 'X-Bootstrap-Token': expiredToken },
    body: { hostname: 'EXPIRED-AGENT' }
  });
  assert(expiredEnrollRes.status === 401, 'Expired bootstrap token rejected with 401');

  // 6. Test Telemetry Ingestion with Device Token
  // 6a. Unauthenticated telemetry rejected
  const unauthTelemRes = await makeRequest('/api/v1/ingest/telemetry', {
    method: 'POST',
    body: { hostname: testHostA, metrics: { cpu: { utilization_pct: 15 } } }
  });
  assert(unauthTelemRes.status === 401, 'Telemetry without device credentials rejected with 401');

  // 6b. Valid telemetry with X-Device-Token succeeds
  const validTelemRes = await makeRequest('/api/v1/ingest/telemetry', {
    method: 'POST',
    headers: { 'X-Device-Token': deviceTokenA },
    body: {
      hostname: testHostA,
      metrics: { cpu: { utilization_pct: 22.5 }, ram: { utilization_pct: 48.0 } },
      posture: { bitlocker_status: 'PROTECTED', antivirus_status: 'ACTIVE' }
    }
  });
  assert(validTelemRes.status === 200, 'Telemetry with valid X-Device-Token accepted (200 OK)');

  // 7. Test Cross-Device Impersonation Protection
  // Enroll a second device
  const testHostB = 'SECURITY-AGENT-BETA';
  const msiResB = await makeRequest('/api/v1/msi/generate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { package_name: 'Bundle-Beta', version: '2.5.0' }
  });
  const enrollResB = await makeRequest('/api/v1/agent/enroll', {
    method: 'POST',
    headers: { 'X-Bootstrap-Token': msiResB.body.bootstrap_token },
    body: { hostname: testHostB }
  });
  const deviceTokenB = enrollResB.body.device_token;

  // Attempt to submit telemetry for Device A using Device B's token
  const impersonateTelemRes = await makeRequest('/api/v1/ingest/telemetry', {
    method: 'POST',
    headers: { 'X-Device-Token': deviceTokenB },
    body: { hostname: testHostA, metrics: { cpu: { utilization_pct: 99.9 } } }
  });
  assert(impersonateTelemRes.status === 401, 'Cross-device impersonation in telemetry rejected with 401');

  // 8. Command Dispatch, Polling & Cryptographic Signature Round-Trip
  // 8a. Admin dispatches command to Device A
  const dispatchRes = await makeRequest('/api/v1/commands/dispatch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { device_id: testHostA, kind: 'COLLECT_FORENSICS', payload: { target_log: 'Security.evtx' } }
  });
  assert(dispatchRes.status === 201, 'Admin dispatched command to Device A');
  const commandId = dispatchRes.body.id;

  // 8b. Unauthenticated poll rejected
  const unauthPollRes = await makeRequest(`/api/commands/poll?hostname=${testHostA}`);
  assert(unauthPollRes.status === 401, 'Unauthenticated command poll rejected with 401');

  // 8c. Poll with wrong device token rejected
  const wrongPollRes = await makeRequest(`/api/commands/poll?hostname=${testHostA}`, {
    headers: { 'X-Device-Token': deviceTokenB }
  });
  assert(wrongPollRes.status === 401, 'Command poll with mismatched device token rejected with 401');

  // 8d. Poll with correct device token succeeds and returns signed command payload
  const pollRes = await makeRequest(`/api/commands/poll?hostname=${testHostA}`, {
    headers: { 'X-Device-Token': deviceTokenA }
  });
  assert(pollRes.status === 200, 'Command poll with valid X-Device-Token succeeds (200 OK)');
  assert(Array.isArray(pollRes.body) && pollRes.body.length > 0, 'Received dispatched command in poll queue');

  const polledCmd = pollRes.body.find(c => c.id === commandId);
  assert(!!polledCmd, 'Found dispatched command by ID in poll result');
  assert(!!polledCmd.signature, 'Command payload contains cryptographic HMAC signature');
  assert(!!polledCmd.signed_content, 'Command payload contains signed_content string');

  // 8e. Verify HMAC signature matches COMMAND_SIGNING_KEY
  const signingKey = enrollRes.body.command_signing_key || process.env.COMMAND_SIGNING_KEY;
  const expectedSig = crypto.createHmac('sha256', signingKey).update(polledCmd.signed_content).digest('hex');
  assert(polledCmd.signature === expectedSig, 'Command HMAC-SHA256 signature cryptographically verified on client side');

  // 9. Command Result Reporting
  // 9a. Result with mismatched token rejected
  const wrongResultRes = await makeRequest(`/api/commands/${commandId}/result`, {
    method: 'POST',
    headers: { 'X-Device-Token': deviceTokenB },
    body: { status: 'completed', output: 'Hacked result', exit_code: 0 }
  });
  assert(wrongResultRes.status === 401, 'Command result submission with mismatched device token rejected with 401');

  // 9b. Result with correct device token accepted
  const validResultRes = await makeRequest(`/api/commands/${commandId}/result`, {
    method: 'POST',
    headers: { 'X-Device-Token': deviceTokenA },
    body: { status: 'completed', output: 'Forensics captured successfully', exit_code: 0 }
  });
  assert(validResultRes.status === 200, 'Command result submission with valid X-Device-Token accepted (200 OK)');

  // 10. Startup verification: verify node fails when BOOTSTRAP_SECRET or COMMAND_SIGNING_KEY missing
  await new Promise((resolveTest) => {
    const child = spawn('node', ['-e', `
      delete process.env.BOOTSTRAP_SECRET;
      delete process.env.COMMAND_SIGNING_KEY;
      import('./server.js').catch(err => {
        process.exit(1);
      });
    `]);

    child.on('close', (code) => {
      assert(code === 1, 'Server refuses to start (process.exit(1)) when required cryptographic secrets are missing');
      resolveTest();
    });
  });

  console.log('=== All 10 Deep Device & Agent Security Verification Tests PASSED ===');
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
