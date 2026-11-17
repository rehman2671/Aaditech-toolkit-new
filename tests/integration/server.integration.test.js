import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { verifyDeviceCommand } from '../../command-signing.js';
import * as db from '../../db.js';
import { app } from '../../server.js';

describe('Server & API Integration Test Suite', () => {
  let adminToken = '';
  let opsToken = '';
  let monitorToken = '';
  let agentToken = '';
  let agentHostname = '';
  let agentDeviceId = '';
  let agentTenantId = '';
  let secondAgentToken = '';

  beforeAll(async () => {
    // Authenticate test personas
    const adminRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Admin123!' });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;

    const opsRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'ops_lead', password: 'Operator123!' });
    expect(opsRes.status).toBe(200);
    opsToken = opsRes.body.token;

    const monitorRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'sec_monitor', password: 'Monitor123!' });
    expect(monitorRes.status).toBe(200);
    monitorToken = monitorRes.body.token;
  });

  describe('0. Agent enrollment transport hardening', () => {
    it('production rejects fleet HMAC-only device impersonation without auto-provisioning', async () => {
      const previousEnvironment = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const response = await request(app)
          .get('/api/v1/commands/poll?hostname=UNENROLLED-HMAC-HOST')
          .set('X-Agent-Signature', 'a'.repeat(64))
          .set('X-Device-UID', 'dev-uid-UNENROLLED-HMAC-HOST')
          .set('X-Timestamp', String(Date.now()));
        expect(response.status).toBe(403);
        expect(response.body.error).toBe('ENROLLED_DEVICE_TOKEN_REQUIRED');
      } finally {
        process.env.NODE_ENV = previousEnvironment;
      }
    });

    it('GET enrollment is rejected instead of treating a bootstrap token in a URL as valid', async () => {
      const res = await request(app).get('/api/v1/agent/enroll?bootstrap_token=invalid&hostname=TEST-LAPTOP');
      expect(res.status).toBe(405);
      expect(res.headers.allow).toContain('POST');
    });
    it('POST enrollment without bootstrap credentials is rejected', async () => {
      const res = await request(app)
        .post('/api/v1/agent/enroll')
        .send({ hostname: 'TEST-LAPTOP' });
      expect(res.status).toBe(401);
    });

    it('POST enrollment rejects missing device hostname before token verification', async () => {
      const res = await request(app)
        .post('/api/v1/agent/enroll')
        .set('X-Bootstrap-Token', 'nonempty-test-token')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('hostname');
    });

    it('POST enrollment rejects a malformed bootstrap token', async () => {
      const res = await request(app)
        .post('/api/v1/agent/enroll')
        .send({ hostname: 'TEST-LAPTOP', bootstrap_token: 'not-a-real-token' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });

  describe('1. Public & Operational Health Endpoints', () => {
    it('GET /healthz returns 200 OK with system status', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.components).toBeDefined();
    });

    it('GET /metrics returns 200 with Prometheus text format', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('aaditech_active_devices');
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('GET /version returns application version info', async () => {
      const res = await request(app).get('/version');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('aaditech-toolkit-enterprise');
    });

    it('GET /api/health returns health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
    });
  });

  describe('2. Authentication & Authorization Enforcement', () => {
    it('POST /api/v1/auth/login fails with 401 on bad password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'WrongPassword!' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('GET /api/v1/auth/me returns 401 when no token is supplied', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/auth/me returns 200 and profile when authenticated with Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('admin');
      expect(res.body.role).toBe('SUPER_ADMIN');
    });

    it('POST /api/v1/auth/logout invalidates session and clears cookies', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('Protected endpoints return 401 when unauthenticated', async () => {
      const endpoints = [
        ['get', '/api/v1/devices'],
        ['get', '/api/v1/users'],
        ['get', '/api/v1/policies'],
        ['get', '/api/v1/audit/logs'],
        ['get', '/api/v1/tickets'],
        ['get', '/api/v1/settings/retention']
      ];

      for (const [method, path] of endpoints) {
        const res = await request(app)[method](path);
        expect(res.status).toBe(401);
      }
    });

    it('RBAC: MONITORING role is forbidden (403) from admin mutation endpoints', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${monitorToken}`)
        .send({
          username: 'unauth_user',
          password: 'Password123!',
          email: 'unauth@aaditech.com'
        });
      expect(res.status).toBe(403);
    });
  });

  describe('3. Request Body Input Validation (Zod Middleware)', () => {
    let token = '';

    beforeAll(async () => {
      const adminLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'Admin123!' });
      token = adminLogin.body.token;
    });

    it('POST /api/v1/auth/login returns 400 when body is missing required fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.errors).toBeDefined();
    });

    it('POST /api/v1/users returns 400 when payload is invalid', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'ab' }); // invalid username length < 3
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('POST /api/v1/companies returns 400 on missing name', async () => {
      const res = await request(app)
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('POST /api/v1/commands/dispatch returns 400 on missing required target/kind', async () => {
      const res = await request(app)
        .post('/api/v1/commands/dispatch')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('POST /api/v1/alerts/rules returns 400 on missing metric or threshold', async () => {
      const res = await request(app)
        .post('/api/v1/alerts/rules')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Rule without metric' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('POST /api/v1/policies returns 400 on missing policy_type', async () => {
      const res = await request(app)
        .post('/api/v1/policies')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Incomplete Policy' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('POST /api/v1/groups returns 400 on missing group name', async () => {
      const res = await request(app)
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('POST /api/v1/tickets returns 400 on missing title', async () => {
      const res = await request(app)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('POST /api/v1/settings/retention returns 400 on out-of-range days', async () => {
      const res = await request(app)
        .post('/api/v1/settings/retention')
        .set('Authorization', `Bearer ${token}`)
        .send({ raw_telemetry_days: 99999 }); // max is 3650
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('GET /api/v1/devices returns 400 Bad Request when limit parameter is invalid or exceeds maxLimit', async () => {
      const resOver = await request(app)
        .get('/api/v1/devices?limit=9999')
        .set('Authorization', `Bearer ${token}`);
      expect(resOver.status).toBe(400);
      expect(resOver.body.error).toBe('Limit exceeded');

      const resNeg = await request(app)
        .get('/api/v1/devices?limit=-5')
        .set('Authorization', `Bearer ${token}`);
      expect(resNeg.status).toBe(400);
      expect(resNeg.body.error).toBe('Invalid query parameter');

      const resValid = await request(app)
        .get('/api/v1/devices?limit=10&offset=0')
        .set('Authorization', `Bearer ${token}`);
      expect(resValid.status).toBe(200);
    });
  });

  describe('4. Agent Subsystem Endpoints & Flow', () => {
    let token = '';

    beforeAll(async () => {
      const adminLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'Admin123!' });
      token = adminLogin.body.token;
    });

    it('MSI package generation provides bootstrap token for agent enrollment', async () => {
      const msiRes = await request(app)
        .post('/api/v1/msi/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          package_name: 'Test-Agent-Installer',
          version: '1.2.0',
          single_use: false
        });

      expect(msiRes.status).toBe(201);
      expect(msiRes.body.bootstrap_token).toBeDefined();

      agentHostname = 'INTEG-HOST-' + Math.floor(Math.random() * 1000);
      const uid = 'INTEG-UID-' + Date.now();

      const enrollRes = await request(app)
        .post('/api/v1/agent/enroll')
        .send({
          bootstrap_token: msiRes.body.bootstrap_token,
          device_uid: uid,
          hostname: agentHostname,
          os_version: 'Windows 11 Pro',
          agent_version: '1.2.0'
        });

      expect([200, 201]).toContain(enrollRes.status);
      expect(enrollRes.body.device_token).toBeDefined();
      agentToken = enrollRes.body.device_token;
      agentDeviceId = enrollRes.body.device_id;
      agentTenantId = enrollRes.body.tenant_id;
      expect(enrollRes.body.command_signing_key).toBeUndefined();
    });

    it('rejects an existing hostname with a different UID without spending a one-use token', async () => {
      const msi = await request(app)
        .post('/api/v1/msi/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ package_name: 'Tenant-Collision-Guard', version: '1.2.0', single_use: true });
      expect(msi.status).toBe(201);
      const oneUseToken = msi.body.bootstrap_token;
      expect(oneUseToken).toBeDefined();

      const conflict = await request(app)
        .post('/api/v1/agent/enroll')
        .send({
          hostname: agentHostname,
          device_uid: 'unrelated-uid-' + Date.now(),
          bootstrap_token: oneUseToken
        });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe('DEVICE_UID_CONFLICT');

      // Same valid token must remain available because the rejected device
      // could not consume it, so an actual fresh device can still enroll.
      const fresh = await request(app)
        .post('/api/v1/agent/enroll')
        .send({
          hostname: 'INTEG-FRESH-' + Date.now(),
          device_uid: 'INTEG-FRESH-UID-' + Date.now(),
          bootstrap_token: oneUseToken
        });
      expect(fresh.status).toBe(201);
      expect(fresh.body.device_token).toMatch(/^itk_dev_/);
      secondAgentToken = fresh.body.device_token;
    });

    it('delivers only per-device signed executable commands with verified tenant/expiry', async () => {
      const queued = await request(app)
        .post('/api/v1/commands/dispatch')
        .set('Authorization', `Bearer ${token}`)
        .send({
          device_id: agentDeviceId,
          kind: 'run-script',
          payload: { script: 'Scripts/QuickCheck.ps1' }
        });
      expect(queued.status).toBe(201);
      const poll = await request(app)
        .get('/api/v1/commands/poll')
        .set('X-Device-Token', agentToken)
        .query({ hostname: agentHostname });
      expect(poll.status).toBe(200);
      const delivered = poll.body.find(c => c.id === queued.body.id);
      expect(delivered).toBeDefined();
      const device = { id: agentDeviceId, tenant_id: agentTenantId, hostname: agentHostname };
      expect(verifyDeviceCommand({
        signed_content: delivered.signed_content,
        signature: delivered.signature,
        commandId: delivered.id,
        deviceToken: agentToken,
        device
      })).toBe(true);
      const trusted = JSON.parse(delivered.signed_content);
      expect(trusted.payload.script).toBe('Scripts/QuickCheck.ps1');
      expect(verifyDeviceCommand({
        signed_content: delivered.signed_content,
        signature: delivered.signature,
        commandId: delivered.id,
        deviceToken: agentToken,
        device: { ...device, tenant_id: 'wrong-tenant' }
      })).toBe(false);

      // A command result belongs to the exact enrolled device, not merely a
      // valid fleet HMAC, admin JWT, URL token or a different tenant's agent.
      const resultUrl = `/api/v1/commands/${delivered.id}/result`;
      const body = { status: 'completed', output: 'Signed command executed', exit_code: 0 };
      const jwtResult = await request(app).post(resultUrl)
        .set('Authorization', `Bearer ${token}`).send(body);
      expect(jwtResult.status).toBe(403);

      const queryResult = await request(app).post(`${resultUrl}?device_token=${agentToken}`)
        .send(body);
      // Missing header authentication may be classified as 401 or 403; both
      // are valid fail-closed outcomes. Never accept a successful result.
      expect([401, 403]).toContain(queryResult.status);

      const crossTenantResult = await request(app).post(resultUrl)
        .set('X-Device-Token', secondAgentToken).send(body);
      expect([401, 403]).toContain(crossTenantResult.status);

      const realResult = await request(app).post(resultUrl)
        .set('X-Device-Token', agentToken).send(body);
      expect(realResult.status).toBe(200);
    });

    it('GET /api/v1/features returns enabled feature flags', async () => {
      const res = await request(app)
        .get('/api/v1/features')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body) || typeof res.body === 'object').toBe(true);
    });

    it('POST /api/v1/ingest/telemetry accepts agent telemetry payload with device token', async () => {
      const res = await request(app)
        .post('/api/v1/ingest/telemetry')
        .set('X-Device-Token', agentToken)
        .send({
          hostname: agentHostname,
          cpu_usage: '18.5%',
          memory_usage: '42.0%',
          disk_free: '110 GB',
          metrics: { cpu_load: 18.5 }
        });
      expect([200, 202]).toContain(res.status);
    });

    it('GET /api/v1/commands/poll checks command queue for agent', async () => {
      const res = await request(app)
        .get('/api/v1/commands/poll')
        .set('X-Device-Token', agentToken)
        .query({ hostname: agentHostname });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.commands) || Array.isArray(res.body)).toBe(true);
    });

    it('rejects a revoked per-device credential on BOTH telemetry and command polling', async () => {
      try {
        await db.updateDevice(agentDeviceId, { agent_token_revoked: 1 });
        const telemetry = await request(app)
          .post('/api/v1/ingest/telemetry')
          .set('X-Device-Token', agentToken)
          .send({ hostname: agentHostname, cpu_usage: '5%' });
        expect(telemetry.status).toBe(401);
        expect(telemetry.body.error).toBe('DEVICE_TOKEN_REVOKED');

        const polling = await request(app)
          .get('/api/v1/commands/poll')
          .set('X-Device-Token', agentToken)
          .query({ hostname: agentHostname });
        expect(polling.status).toBe(401);
        expect(polling.body.error).toBe('DEVICE_TOKEN_REVOKED');
      } finally {
        // This suite reuses the enrolled agent in later heartbeat checks.
        await db.updateDevice(agentDeviceId, { agent_token_revoked: 0 });
      }
    });
  });

  describe('5. Pagination on List Endpoints', () => {
    let token = '';

    beforeAll(async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'Admin123!' });
      token = login.body.token;
    });

    const paginatedRoutes = [
      '/api/v1/devices',
      '/api/v1/audit/logs',
      '/api/v1/events',
      '/api/v1/commands',
      '/api/v1/users',
      '/api/v1/companies',
      '/api/v1/alerts',
      '/api/v1/tickets'
    ];

    for (const route of paginatedRoutes) {
      it(`GET ${route} honors limit and offset parameters and sets pagination headers`, async () => {
        const res = await request(app)
          .get(route)
          .query({ limit: 2, offset: 0 })
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.headers['x-total-count']).toBeDefined();
        expect(res.headers['x-limit']).toBe('2');
        expect(res.headers['x-offset']).toBe('0');
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeLessThanOrEqual(2);
      });

      it(`GET ${route}?envelope=true returns envelope schema with pagination metadata`, async () => {
        const res = await request(app)
          .get(route)
          .query({ envelope: 'true', limit: 2, offset: 0 })
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.items).toBeDefined();
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.pagination).toBeDefined();
        expect(res.body.pagination.limit).toBe(2);
        expect(res.body.pagination.offset).toBe(0);
      });
    }
  });

  describe('6. Administrative Operations & CRUD Lifecycles', () => {
    let token = '';

    beforeAll(async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'Admin123!' });
      token = login.body.token;
    });

    it('Company lifecycle: create, get, list', async () => {
      const createRes = await request(app)
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Integration Test Company ' + Date.now() });

      expect(createRes.status).toBe(201);
      expect(createRes.body.name).toBeDefined();

      const listRes = await request(app)
        .get('/api/v1/companies')
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThan(0);
    });

    it('Alert rules lifecycle: create, list, delete', async () => {
      const createRes = await request(app)
        .post('/api/v1/alerts/rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Integ High Memory ' + Date.now(),
          metric: 'memory',
          condition_op: '>=',
          threshold: 88,
          duration_mins: 5,
          severity: 'HIGH'
        });

      expect(createRes.status).toBe(201);
      const ruleId = createRes.body.id;

      const listRes = await request(app)
        .get('/api/v1/alerts/rules')
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);

      if (ruleId) {
        const delRes = await request(app)
          .delete(`/api/v1/alerts/rules/${ruleId}`)
          .set('Authorization', `Bearer ${token}`);
        expect([200, 204]).toContain(delRes.status);
      }
    });

    it('denies cross-workspace audit query overrides and scopes resource access', async () => {
      const foreignTenant = '00000000-0000-0000-0000-000000000002';
      const logs = await request(app).get('/api/v1/audit/logs?tenant_id=' + foreignTenant)
        .set('Authorization', `Bearer ${token}`);
      expect(logs.status).toBe(403);
      expect(logs.body.error).toBe('TENANT_ACCESS_DENIED');

      const allowed = await request(app).get('/api/v1/audit/logs')
        .set('Authorization', `Bearer ${token}`);
      expect(allowed.status).toBe(200);

      for (const url of [
        '/api/v1/devices/UNOWNED-UNKNOWN-DEVICE/processes',
        '/api/v1/devices/UNOWNED-UNKNOWN-DEVICE/app-usage'
      ]) {
        const missing = await request(app).get(url)
          .set('Authorization', `Bearer ${token}`);
        expect(missing.status).toBe(404);
      }
    });

    it('Policies and Groups lifecycle', async () => {
      const polRes = await request(app)
        .post('/api/v1/policies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Integ Policy ' + Date.now(),
          policy_type: 'security'
        });
      expect(polRes.status).toBe(201);

      const grpRes = await request(app)
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Integ Group ' + Date.now(),
          description: 'Created during integration testing'
        });
      expect(grpRes.status).toBe(201);
    });

    it('Tickets lifecycle: create, list', async () => {
      const ticketRes = await request(app)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Integration Test Ticket',
          severity: 'HIGH'
        });
      expect([200, 201]).toContain(ticketRes.status);

      const listRes = await request(app)
        .get('/api/v1/tickets')
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
    });

    it('Data retention settings: get and update', async () => {
      const getRes = await request(app)
        .get('/api/v1/settings/retention')
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);

      const postRes = await request(app)
        .post('/api/v1/settings/retention')
        .set('Authorization', `Bearer ${token}`)
        .send({ raw_telemetry_days: 60 });
      expect(postRes.status).toBe(200);
      expect(postRes.body.raw_telemetry_days).toBe(60);
    });
  });

  describe('7. Extended Route Surface Coverage', () => {
    let token = '';

    beforeAll(async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'Admin123!' });
      token = login.body.token;
    });

    it('Device details, processes and registration lifecycle', async () => {
      const devRes = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          hostname: 'SURFACE-TEST-01',
          os_type: 'WINDOWS',
          os_version: 'Windows 11 Enterprise'
        });
      expect(devRes.status).toBe(201);
      const devId = devRes.body.id;

      // Registrations must not rotate an existing device's token just because
      // a caller reuses the hostname. This exercises tenant identity preflight.
      const duplicate = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({ hostname: 'SURFACE-TEST-01', os_type: 'WINDOWS' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error).toBe('DEVICE_ALREADY_REGISTERED');

      const getDev = await request(app)
        .get(`/api/v1/devices/${devId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(getDev.status).toBe(200);
      expect(getDev.body.hostname).toBe('SURFACE-TEST-01');

      const procRes = await request(app)
        .get(`/api/v1/devices/${devId}/processes`)
        .set('Authorization', `Bearer ${token}`);
      expect(procRes.status).toBe(200);
      expect(procRes.body.processes).toBeDefined();

      const delRes = await request(app)
        .delete(`/api/v1/devices/${devId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(delRes.status).toBe(200);
    });

    it('User management lifecycle (create, list, update)', async () => {
      const uRes = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'audit_test_user_' + Date.now(),
          password: 'AuditPassword123!',
          email: 'audit_test@aaditech.com',
          role: 'OPERATOR'
        });
      expect(uRes.status).toBe(201);
      const uId = uRes.body.id;

      const getList = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${token}`);
      expect(getList.status).toBe(200);
      expect(getList.body.length).toBeGreaterThan(0);

      const putU = await request(app)
        .put(`/api/v1/users/${uId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'MONITORING' });
      expect(putU.status).toBe(200);
    });

    it('Remediation subsystem endpoints', async () => {
      const pols = await request(app)
        .get('/api/v1/remediation/policies')
        .set('Authorization', `Bearer ${token}`);
      expect(pols.status).toBe(200);
      expect(Array.isArray(pols.body.policies)).toBe(true);
      expect(Array.isArray(pols.body.logs)).toBe(true);

      const putPol = await request(app)
        .put('/api/v1/remediation/policies/clean_temp')
        .set('Authorization', `Bearer ${token}`)
        .send({ enabled: true });
      expect([200, 404]).toContain(putPol.status);

      const trigRes = await request(app)
        .post('/api/v1/remediation/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({
          action_type: 'clean_temp_files',
          hostname: agentHostname
        });
      expect(trigRes.status).toBe(200);
      expect(trigRes.body.ok).toBe(true);

      const foreignOrMissing = await request(app)
        .post('/api/v1/remediation/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({ action_type: 'clean_temp_files', hostname: 'UNAUTHORIZED-UNKNOWN-HOST' });
      expect(foreignOrMissing.status).toBe(404);
      expect(foreignOrMissing.body.error).toBe('Target agent/device not found');
    });

    it('Patch inventory and security posture', async () => {
      const patches = await request(app)
        .get('/api/v1/patches/summary')
        .set('Authorization', `Bearer ${token}`);
      expect(patches.status).toBe(200);

      const posture = await request(app)
        .get('/api/v1/security/posture')
        .set('Authorization', `Bearer ${token}`);
      expect(posture.status).toBe(200);

      const approveRes = await request(app)
        .post('/api/v1/patches/kb-5034441/approve')
        .set('Authorization', `Bearer ${token}`);
      expect([200, 404]).toContain(approveRes.status);
    });

    it('Software search, license compliance and fleet exports', async () => {
      const soft = await request(app)
        .get('/api/v1/software/search?q=chrome')
        .set('Authorization', `Bearer ${token}`);
      expect(soft.status).toBe(200);

      const softExp = await request(app)
        .get('/api/v1/software/export')
        .set('Authorization', `Bearer ${token}`);
      expect(softExp.status).toBe(200);
      expect(softExp.text).toContain('Hostname');

      const lic = await request(app)
        .get('/api/v1/license/compliance')
        .set('Authorization', `Bearer ${token}`);
      expect(lic.status).toBe(200);

      const licExp = await request(app)
        .get('/api/v1/license/export')
        .set('Authorization', `Bearer ${token}`);
      expect(licExp.status).toBe(200);

      const fleet = await request(app)
        .get('/api/v1/reports/fleet')
        .set('Authorization', `Bearer ${token}`);
      expect(fleet.status).toBe(200);
    });

    it('Alerts webhooks require tenant opt-in, allowlisted HTTPS and real delivery', async () => {
      const hookGet = await request(app)
        .get('/api/v1/alerts/webhook')
        .set('Authorization', `Bearer ${token}`);
      expect(hookGet.status).toBe(200);
      expect(hookGet.body).toMatchObject({ enabled: false, type: 'generic', url: '' });

      // No deployment operator has approved a webhook host in this test.
      // A tenant admin alone cannot exfiltrate event data to arbitrary URLs.
      const hookPut = await request(app)
        .put('/api/v1/alerts/webhook')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'slack', url: 'https://unapproved.example.com/integration', enabled: true });
      expect(hookPut.status).toBe(400);
      expect(hookPut.body.error).toBe('WEBHOOK_URL_NOT_APPROVED');

      const hookTest = await request(app)
        .post('/api/v1/alerts/test-webhook')
        .set('Authorization', `Bearer ${token}`);
      expect(hookTest.status).toBe(400);
      expect(hookTest.body.error).toBe('NOT_CONFIGURED');

      // A tenant without consent must never attempt to deliver email.
      const emailTest = await request(app)
        .post('/api/v1/alerts/test-email')
        .set('Authorization', `Bearer ${token}`);
      expect(emailTest.status).toBe(400);
      expect(emailTest.body.error).toBe('NOT_CONFIGURED');

      const emailGet = await request(app)
        .get('/api/v1/alerts/email')
        .set('Authorization', `Bearer ${token}`);
      expect(emailGet.status).toBe(200);
      expect(emailGet.body).toMatchObject({ enabled: false, smtp_configured: false });
      expect(emailGet.body).not.toHaveProperty('password');

      const emailEnable = await request(app)
        .put('/api/v1/alerts/email')
        .set('Authorization', `Bearer ${token}`)
        .send({ enabled: true, recipient: 'ops@example.com' });
      expect(emailEnable.status).toBe(503);
      expect(emailEnable.body.error).toBe('SMTP_NOT_CONFIGURED');
    });

    it('Branding, bootstrap, retention trigger, and system status', async () => {
      const boot = await request(app)
        .get('/api/v1/bootstrap')
        .set('Authorization', `Bearer ${token}`);
      expect(boot.status).toBe(200);

      const dbStat = await request(app)
        .get('/api/v1/database/status')
        .set('Authorization', `Bearer ${token}`);
      expect(dbStat.status).toBe(200);

      const retRun = await request(app)
        .post('/api/v1/settings/retention/run')
        .set('Authorization', `Bearer ${token}`);
      expect(retRun.status).toBe(200);

      const brandPut = await request(app)
        .post('/api/v1/settings/default-company')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Aaditech Enterprise' });
      expect(brandPut.status).toBe(200);
      expect(brandPut.body.company_name).toBe('Aaditech Enterprise');

      const unowned = await request(app)
        .post('/api/v1/settings/default-company')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Unowned Tenant Company' });
      expect(unowned.status).toBe(404);
    });

    it('Public artifacts: CA cert, bundle, installer scripts', async () => {
      const cert = await request(app).get('/api/ca.crt');
      expect(cert.status).toBe(200);

      const bundle = await request(app).get('/api/agent-bundle');
      expect(bundle.status).toBe(200);

      const json = await request(app).get('/api/agent/agent.json');
      expect(json.status).toBe(200);

      const cmd = await request(app).get('/api/agent/install.cmd');
      expect(cmd.status).toBe(200);

      const ps1 = await request(app).get('/api/agent/install.ps1');
      expect(ps1.status).toBe(200);
    });

    it('Command queue dispatch, get by ID, and execution completion', async () => {
      const devices = await request(app)
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`);
      expect(devices.status).toBe(200);

      if (devices.body.length > 0) {
        const targetDev = devices.body[0];
        const dispatchRes = await request(app)
          .post('/api/v1/commands/dispatch')
          .set('Authorization', `Bearer ${token}`)
          .send({
            device_id: targetDev.id,
            command_type: 'DIAGNOSTIC',
            payload: { action: 'ping' }
          });
        expect(dispatchRes.status).toBe(201);
        const cmdId = dispatchRes.body.id;

        const cmdGet = await request(app)
          .get(`/api/v1/commands/${cmdId}`)
          .set('Authorization', `Bearer ${token}`);
        expect([200, 404]).toContain(cmdGet.status);

        const resultRes = await request(app)
          .post(`/api/v1/commands/${cmdId}/result`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            status: 'completed',
            output: 'Ping successful',
            exit_code: 0
          });
        // This is an agent-only endpoint. An admin JWT cannot forge a
        // result for an arbitrary device, even if that user dispatched it.
        expect(resultRes.status).toBe(403);
      }
    });

    it('Agent heartbeat endpoint with device credential', async () => {
      const hb = await request(app)
        .post('/api/v1/agent/heartbeat')
        .set('X-Device-Token', agentToken)
        .send({ hostname: agentHostname });
      expect([200, 401]).toContain(hb.status);
    });
  });

  describe('8. Operational Surface & Analytics Endpoints', () => {
    let token = '';

    beforeAll(async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'Admin123!' });
      token = login.body.token;
    });

    it('Predictive analytics and fleet insights', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/predictive')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.predictions).toBeDefined();
    });

    it('Tenants list and alert open counts', async () => {
      const ten = await request(app)
        .get('/api/v1/tenants')
        .set('Authorization', `Bearer ${token}`);
      expect(ten.status).toBe(200);

      const openAlts = await request(app)
        .get('/api/v1/alerts/open')
        .set('Authorization', `Bearer ${token}`);
      expect(openAlts.status).toBe(200);
      expect(typeof openAlts.body.open).toBe('number');
    });

    it('Alert acknowledgement and resolution', async () => {
      const alerts = await request(app)
        .get('/api/v1/alerts')
        .set('Authorization', `Bearer ${token}`);
      if (alerts.body.length > 0) {
        const altId = alerts.body[0].id;
        const ack = await request(app)
          .post(`/api/v1/alerts/${altId}/acknowledge`)
          .set('Authorization', `Bearer ${token}`);
        expect(ack.status).toBe(200);

        const resv = await request(app)
          .post(`/api/v1/alerts/${altId}/resolve`)
          .set('Authorization', `Bearer ${token}`);
        expect(resv.status).toBe(200);
      }
    });

    it('Device app-usage and CSV report generation', async () => {
      const devs = await request(app)
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`);
      if (devs.body.length > 0) {
        const devId = devs.body[0].id;
        const appUse = await request(app)
          .get(`/api/v1/devices/${devId}/app-usage`)
          .set('Authorization', `Bearer ${token}`);
        expect(appUse.status).toBe(200);
        expect(appUse.body.app_usage).toBeDefined();

        const csvRep = await request(app)
          .get(`/api/v1/reports/device/${devId}?format=csv`)
          .set('Authorization', `Bearer ${token}`);
        expect(csvRep.status).toBe(200);
        expect(csvRep.text).toContain('Hostname');
      }
    });

    it('Feature flag updates and setup status', async () => {
      const featRes = await request(app)
        .put('/api/v1/features/bitlocker')
        .set('Authorization', `Bearer ${token}`)
        .send({ default_enabled: true });
      expect(featRes.status).toBe(200);

      const setupStat = await request(app).get('/api/v1/setup/status');
      expect(setupStat.status).toBe(200);

      const setupPost = await request(app)
        .post('/api/v1/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ company_name: 'Aaditech Enterprise Corp' });
      expect([200, 400]).toContain(setupPost.status);
    });

    it('Agent bundle zip download and MSI download endpoint', async () => {
      const zipRes = await request(app).get('/api/agent/bundle.zip');
      expect(zipRes.status).toBe(200);
      expect(zipRes.headers['content-type']).toContain('zip');

      const msiRes = await request(app).get('/api/v1/agent-msi');
      expect([200, 404]).toContain(msiRes.status);

      const caRes = await request(app).get('/api/v1/ca.crt');
      expect(caRes.status).toBe(200);

      const updateTarget = await request(app)
        .put('/api/v1/agent/update-target')
        .set('Authorization', `Bearer ${token}`)
        .send({ target_version: '2.4.1' });
      expect(updateTarget.status).toBe(200);
    });

    it('Build status and build trigger endpoints', async () => {
      const bStatus = await request(app)
        .get('/api/v1/build/status')
        .set('Authorization', `Bearer ${token}`);
      expect(bStatus.status).toBe(200);

      const bTrig = await request(app)
        .post('/api/v1/build/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({ branch: 'main' });
      // Without private GITHUB_ACTIONS_* server credentials, dispatch fails
      // closed; a successful dispatch only acknowledges GitHub's queue.
      expect([202, 503, 502]).toContain(bTrig.status);

      const untrustedRepo = await request(app)
        .post('/api/v1/build/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({ branch: 'main', repo: 'unapproved/other-repository',
          token: 'untrusted_browser_pat' });
      expect(untrustedRepo.status).toBe(400);
      expect(untrustedRepo.body.errors).toBeDefined();
      const untrustedBranch = await request(app)
        .post('/api/v1/build/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({ branch: 'unsafe-feature' });
      expect(untrustedBranch.status).toBe(400);
    });

    it('MSI packages listing and download by id', async () => {
      const pkgs = await request(app)
        .get('/api/v1/msi/packages')
        .set('Authorization', `Bearer ${token}`);
      expect(pkgs.status).toBe(200);

      if (pkgs.body.length > 0) {
        const pkgId = pkgs.body[0].id;
        const dl = await request(app)
          .get(`/api/v1/msi/download/${pkgId}`)
          .set('Authorization', `Bearer ${token}`);
        expect([200, 404]).toContain(dl.status);
      }
    });
  });
});
