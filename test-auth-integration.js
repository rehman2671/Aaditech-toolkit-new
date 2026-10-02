// test-auth-integration.js
import 'dotenv/config';
import http from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || "aaditech_enterprise_jwt_super_secret_key_2026_dev";
const HMAC_SECRET = process.env.HMAC_SECRET || "aaditech_hmac_secret_key_dev_2026";
const AGENT_API_TOKEN = process.env.API_TOKEN || "itk_agent_sec_token_998877";

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (data) {
      reqHeaders['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let chunks = '';
      res.on('data', chunk => chunks += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(chunks);
        } catch {
          parsed = chunks;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('=== Starting Real Authentication & Authorization Test Suite ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`PASS: ${message}`);
      passed++;
    } else {
      console.error(`FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Unauthenticated requests to protected endpoints MUST return 401
    const noAuthDev = await request('GET', '/api/v1/devices');
    assert(noAuthDev.status === 401, 'Unauthenticated GET /api/v1/devices returns 401');

    const noAuthLegacy = await request('GET', '/api/agents');
    assert(noAuthLegacy.status === 401, 'Unauthenticated GET /api/agents returns 401');

    // 2. Public endpoints work without auth
    const health = await request('GET', '/healthz');
    assert(health.status === 200, 'Public GET /healthz returns 200 without token');

    const setupStatus = await request('GET', '/api/setup/status');
    assert(setupStatus.status === 200, 'Public GET /api/setup/status returns 200 without token');

    // 3. Login with invalid password fails
    const badLogin = await request('POST', '/api/v1/auth/login', { username: 'admin', password: 'WrongPassword!' });
    assert(badLogin.status === 401, 'POST /api/v1/auth/login with wrong password returns 401');

    // 4. Login with correct bcrypt passwords for all seeded accounts
    const adminLogin = await request('POST', '/api/v1/auth/login', { username: 'admin', password: 'Admin123!' });
    assert(adminLogin.status === 200 && adminLogin.body.token, 'Super admin logs in successfully with bcrypt');
    const adminToken = adminLogin.body.token;

    const opsLogin = await request('POST', '/api/v1/auth/login', { username: 'ops_lead', password: 'Operator123!' });
    assert(opsLogin.status === 200 && opsLogin.body.user.role === 'OPERATOR', 'Operator logs in successfully with role OPERATOR');
    const opsToken = opsLogin.body.token;

    const secLogin = await request('POST', '/api/v1/auth/login', { username: 'sec_monitor', password: 'Monitor123!' });
    assert(secLogin.status === 200 && secLogin.body.user.role === 'MONITORING', 'Security monitor logs in successfully with role MONITORING');
    const secToken = secLogin.body.token;

    // 5. Tampered token signature fails
    const tamperedToken = adminToken.slice(0, -5) + 'abcde';
    const tamperedReq = await request('GET', '/api/v1/devices', null, { 'Authorization': `Bearer ${tamperedToken}` });
    assert(tamperedReq.status === 401, 'Tampered JWT signature returns 401');

    // 6. Valid user JWT allows viewing devices & user identity
    const meReq = await request('GET', '/api/v1/auth/me', null, { 'Authorization': `Bearer ${adminToken}` });
    assert(meReq.status === 200 && meReq.body.username === 'admin', 'GET /api/v1/auth/me returns verified user profile');

    const devReq = await request('GET', '/api/v1/devices', null, { 'Authorization': `Bearer ${adminToken}` });
    assert(devReq.status === 200 && Array.isArray(devReq.body), 'GET /api/v1/devices returns device list for authenticated user');

    // 7. Role-Based Access Control (RBAC)
    // Monitoring role cannot dispatch commands (needs SUPER_ADMIN or OPERATOR)
    const monitorDispatch = await request('POST', '/api/commands', {
      device_id: 1,
      command_type: 'DIAGNOSTIC'
    }, { 'Authorization': `Bearer ${secToken}` });
    assert(monitorDispatch.status === 403, 'MONITORING user attempting command dispatch returns 403 Forbidden');

    // Operator CAN dispatch commands
    const operatorDispatch = await request('POST', '/api/commands', {
      device_id: 1,
      command_type: 'DIAGNOSTIC'
    }, { 'Authorization': `Bearer ${opsToken}` });
    assert(operatorDispatch.status === 201, 'OPERATOR user successfully dispatches command (201 Created)');

    // Operator CANNOT create new users (only SUPER_ADMIN can)
    const operatorCreateUser = await request('POST', '/api/users', {
      username: 'test_user_forbidden',
      password: 'SomePassword123!',
      role: 'OPERATOR'
    }, { 'Authorization': `Bearer ${opsToken}` });
    assert(operatorCreateUser.status === 403, 'OPERATOR user attempting to create users returns 403 Forbidden');

    // Super Admin CAN create new users
    const uniqueUser = `auditor_${Date.now()}`;
    const adminCreateUser = await request('POST', '/api/users', {
      username: uniqueUser,
      password: 'AuditorPassword123!',
      role: 'MONITORING'
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert(adminCreateUser.status === 201 && adminCreateUser.body.username === uniqueUser, 'SUPER_ADMIN user creates new user successfully');

    // Verify newly created user can log in with bcrypt
    const newUserLogin = await request('POST', '/api/v1/auth/login', {
      username: uniqueUser,
      password: 'AuditorPassword123!'
    });
    assert(newUserLogin.status === 200, 'Newly created user successfully logs in with bcrypt');

    // 8. Agent / Device Authentication (no user token needed)
    // Telemetry ingestion without token fails
    const noAgentAuth = await request('POST', '/api/v1/ingest/telemetry', {
      hostname: 'AGENT-TEST-01',
      cpu_percent: 14.5
    });
    assert(noAgentAuth.status === 401, 'Ingest telemetry without agent token returns 401');

    // Telemetry ingestion with agent token succeeds
    const agentTokenAuth = await request('POST', '/api/v1/ingest/telemetry', {
      hostname: 'AGENT-TEST-01',
      cpu_percent: 14.5
    }, { 'x-agent-token': AGENT_API_TOKEN });
    assert(agentTokenAuth.status === 200, 'Ingest telemetry with x-agent-token succeeds (200 OK)');

    // Telemetry ingestion with HMAC signature succeeds
    const timestamp = Date.now().toString();
    const deviceUid = 'dev-uid-win-srv01';
    const hmacSig = crypto.createHmac('sha256', HMAC_SECRET)
      .update(`${deviceUid}:${timestamp}`)
      .digest('hex');

    const hmacAuth = await request('POST', '/api/v1/ingest/telemetry', {
      hostname: 'WIN-SRV01',
      cpu_percent: 22.1
    }, {
      'x-device-uid': deviceUid,
      'x-timestamp': timestamp,
      'x-agent-signature': hmacSig
    });
    assert(hmacAuth.status === 200, 'Ingest telemetry with HMAC SHA-256 signature succeeds (200 OK)');

    // 9. Logout and Token Revocation
    const logoutRes = await request('POST', '/api/v1/auth/logout', null, { 'Authorization': `Bearer ${adminToken}` });
    assert(logoutRes.status === 200, 'POST /api/v1/auth/logout invalidates session');

    // Re-using revoked token fails
    const revokedReq = await request('GET', '/api/v1/devices', null, { 'Authorization': `Bearer ${adminToken}` });
    assert(revokedReq.status === 401, 'Subsequent request with revoked token returns 401 Unauthorized');

    console.log(`\n=== Test Suite Complete: ${passed} Passed, ${failed} Failed ===`);
    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
