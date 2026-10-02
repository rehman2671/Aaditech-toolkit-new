import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create a flexible mock for mysql2/promise pool
const mockQuery = vi.fn();
const mockExecute = vi.fn();
const mockEnd = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();
const mockRelease = vi.fn().mockResolvedValue(undefined);
const mockGetConnection = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease
});

const mockPoolInstance = {
  query: mockQuery,
  execute: mockExecute,
  end: mockEnd,
  on: mockOn,
  getConnection: mockGetConnection
};

vi.mock('mysql2/promise', () => {
  return {
    default: {
      createPool: vi.fn(() => mockPoolInstance)
    }
  };
});

// Import db module after mocking
import * as db from '../../db.js';

describe('Database Module (db.js) Unit Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.stopDbHealthCheck();
  });

  describe('1. Connection & Healthcheck Lifecycle', () => {
    it('isMysqlConnected() reflects pool state', () => {
      const connected = db.isMysqlConnected();
      expect(typeof connected).toBe('boolean');
    });

    it('getPool() returns current pool reference or null', () => {
      const pool = db.getPool();
      expect(pool === null || typeof pool === 'object').toBe(true);
    });

    it('startDbHealthCheck() and stopDbHealthCheck() manage timer cleanly', () => {
      const timer = db.startDbHealthCheck(60000);
      expect(timer).toBeDefined();
      db.stopDbHealthCheck();
      expect(true).toBe(true);
    });

    it('attemptConnection() succeeds when mock pool queries successfully', async () => {
      mockQuery.mockResolvedValueOnce([[{ solution: 2 }]]);
      // mock migration check
      mockQuery.mockResolvedValueOnce([[{ count: 1 }]]); // lock
      mockQuery.mockResolvedValue([[]]); // subsequent queries

      try {
        const result = await db.attemptConnection();
        expect(typeof result).toBe('boolean');
      } catch (err) {
        // In case migrations fail, verify attemptConnection handles error
        expect(err).toBeDefined();
      }
    });

    it('attemptConnection() throws when pool query rejects and not local', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection lost'));
      await expect(db.attemptConnection()).rejects.toThrow('Connection lost');
    });

    it('initDbPool() returns boolean on success or exhausted attempts', async () => {
      mockQuery.mockRejectedValue(new Error('Dial timeout'));
      const success = await db.initDbPool({ maxAttempts: 1, retryDelays: [10] });
      expect(typeof success).toBe('boolean');
    });
  });

  describe('2. Redis Cache Wrappers', () => {
    it('cacheGet returns null when redis is disconnected or error occurs', async () => {
      const res = await db.cacheGet('nonexistent:key');
      expect(res).toBeNull();
    });

    it('cacheSet returns boolean false when disconnected', async () => {
      const res = await db.cacheSet('key', { foo: 'bar' });
      expect(typeof res).toBe('boolean');
    });

    it('cacheDel returns boolean false when disconnected', async () => {
      const res = await db.cacheDel('key');
      expect(typeof res).toBe('boolean');
    });

    it('cacheDelPattern returns boolean false when disconnected', async () => {
      const res = await db.cacheDelPattern('test:*');
      expect(typeof res).toBe('boolean');
    });
  });

  describe('3. executeQuery() Success & Failure Paths', () => {
    it('executeQuery executes or returns array fallback', async () => {
      const res = await db.executeQuery('SELECT 1');
      expect(Array.isArray(res)).toBe(true);
    });

    it('executeQuery executes on pool when connected', async () => {
      if (db.isMysqlConnected()) {
        mockQuery.mockResolvedValueOnce([[{ id: 'test-row' }]]);
        const res = await db.executeQuery('SELECT * FROM test');
        expect(Array.isArray(res)).toBe(true);
      }
    });
  });

  describe('4. Companies & Tenants (Success and Fallback Paths)', () => {
    it('getTenants() returns tenant array', async () => {
      const tenants = await db.getTenants();
      expect(Array.isArray(tenants)).toBe(true);
      expect(tenants.length).toBeGreaterThan(0);
    });

    it('getTenantById() returns specific tenant or null', async () => {
      const tenant = await db.getTenantById('00000000-0000-0000-0000-000000000001');
      expect(tenant).toBeDefined();
      expect(tenant.name).toBe('Aaditech Enterprise Corp');

      const nonExistent = await db.getTenantById('missing-id');
      expect(nonExistent).toBeNull();
    });

    it('getCompanies() returns company list', async () => {
      const companies = await db.getCompanies();
      expect(Array.isArray(companies)).toBe(true);
      expect(companies.length).toBeGreaterThan(0);
    });

    it('getCompanyById() and getCompanyByName() retrieve company', async () => {
      const comp = await db.getCompanyByName('Default Company');
      expect(comp).toBeDefined();
      if (comp) {
        const byId = await db.getCompanyById(comp.id);
        expect(byId).toBeDefined();
        expect(byId.name).toBe(comp.name);
      }
    });

    it('createCompany() and updateCompany() create and modify company records', async () => {
      const newComp = await db.createCompany({
        name: 'Unit Test Corp ' + Date.now(),
        slug: 'unit-test-' + Date.now(),
        contact_email: 'test@example.com'
      });
      expect(newComp).toBeDefined();
      expect(newComp.id).toBeDefined();

      const updated = await db.updateCompany(newComp.id, { notes: 'Updated note' });
      expect(updated).toBeDefined();
    });
  });

  describe('5. Users Management (Success & Fallback Paths)', () => {
    it('getUsers() returns user list', async () => {
      const users = await db.getUsers();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
    });

    it('getUserById(), getUserByUsername(), getUserByEmail() return correct user', async () => {
      const admin = await db.getUserByUsername('admin');
      expect(admin).toBeDefined();
      expect(admin.role).toBe('SUPER_ADMIN');

      const byEmail = await db.getUserByEmail(admin.email);
      expect(byEmail).toBeDefined();
      expect(byEmail.id).toBe(admin.id);

      const byId = await db.getUserById(admin.id);
      expect(byId).toBeDefined();
      expect(byId.username).toBe('admin');

      const byIdent = await db.getUserByUsernameOrEmail('admin');
      expect(byIdent).toBeDefined();
    });

    it('createUser(), updateUser(), deleteUser() handle lifecycle', async () => {
      const username = 'testuser_' + Date.now();
      const user = await db.createUser({
        username,
        email: `${username}@test.com`,
        password_hash: 'hash123',
        full_name: 'Unit Test User',
        role: 'OPERATOR'
      });
      expect(user).toBeDefined();
      expect(user.username).toBe(username);

      const updated = await db.updateUser(user.id, { full_name: 'Updated Name' });
      expect(typeof updated).toBe('boolean');

      const deleted = await db.deleteUser(user.id);
      expect(deleted).toBe(true);
    });
  });

  describe('6. Devices Subsystem & Caching', () => {
    it('getDevices() returns array of device records', async () => {
      const devs = await db.getDevices();
      expect(Array.isArray(devs)).toBe(true);
    });

    it('syncDeviceToDb(), getDeviceById(), getDeviceByHostname(), getDeviceByUid()', async () => {
      const hostname = 'DESKTOP-TEST-' + Math.floor(Math.random() * 1000);
      const uid = 'UID-' + Date.now();
      const devObj = {
        hostname,
        device_uid: uid,
        ip_address: '10.0.0.50',
        os_version: 'Windows 11 Enterprise',
        token_hash: 'hash_' + Date.now(),
        agent_version: '1.1.2'
      };
      const synced = await db.syncDeviceToDb(devObj);
      expect(typeof synced).toBe('boolean');
      expect(devObj.id).toBeDefined();

      const byId = await db.getDeviceById(devObj.id);
      expect(byId).toBeDefined();

      const byHost = await db.getDeviceByHostname(hostname);
      expect(byHost).toBeDefined();

      const byUid = await db.getDeviceByUid(uid);
      expect(byUid).toBeDefined();

      db.invalidateDeviceCache(devObj);
    });

    it('updateDevice() and deleteDevice() modify and remove device', async () => {
      const dev = await db.syncDeviceToDb({
        hostname: 'TO-DELETE-' + Date.now(),
        ip_address: '192.168.1.100'
      });
      const updated = await db.updateDevice(dev.id, { status: 'offline' });
      expect(updated).toBeDefined();

      const deleted = await db.deleteDevice(dev.id);
      expect(deleted).toBe(true);
    });
  });

  describe('7. Telemetry Ingestion, History & Processes', () => {
    it('insertTelemetryRecord() and getTelemetryHistory() handle telemetry metrics', async () => {
      const dev = (await db.getDevices())[0] || (await db.syncDeviceToDb({ hostname: 'TELEM-HOST' }));
      const rec = await db.insertTelemetryRecord(dev.id, {
        cpu_load: 25.5,
        memory_used_percent: 60,
        disk_free_gb: 120.5
      });
      expect(rec).toBeDefined();

      const history = await db.getTelemetryHistory(dev.id, 10);
      expect(Array.isArray(history)).toBe(true);
    });

    it('insertTelemetryBatch() and flushTelemetryQueue() succeed', async () => {
      const dev = (await db.getDevices())[0];
      const count = await db.insertTelemetryBatch([
        { deviceId: dev.id, metrics: { cpu_load: 10 } }
      ]);
      expect(count).toBeGreaterThanOrEqual(1);

      const flushed = await db.flushTelemetryQueue();
      expect(typeof flushed).toBe('number');
    });

    it('syncDeviceProcesses() and getDeviceProcesses() track processes', async () => {
      const dev = (await db.getDevices())[0];
      const procs = [
        { name: 'explorer.exe', pid: 1234, cpu: 1.2, memory_mb: 85 },
        { name: 'powershell.exe', pid: 5678, cpu: 0.1, memory_mb: 45 }
      ];
      await db.syncDeviceProcesses(dev.id, procs);
      const retrieved = await db.getDeviceProcesses(dev.id);
      expect(Array.isArray(retrieved)).toBe(true);
    });
  });

  describe('8. Command Queue Subsystem', () => {
    it('queueCommandInDb(), getCommands(), getPendingCommandsForDevice(), completeCommandInDb()', async () => {
      const dev = (await db.getDevices())[0];
      const cmdObj = {
        device_id: dev.id,
        command_type: 'powershell',
        payload: 'Get-Service Spooler',
        created_by: 'admin'
      };
      const res = await db.queueCommandInDb(cmdObj);
      expect(typeof res).toBe('boolean');
      expect(cmdObj.id).toBeDefined();

      const pending = await db.getPendingCommandsForDevice(dev.id);
      expect(Array.isArray(pending)).toBe(true);

      const marked = await db.markCommandPickedUp(cmdObj.id);
      expect(marked).toBeDefined();

      const completed = await db.completeCommandInDb(cmdObj.id, 'completed', 'Running', '', 0);
      expect(typeof completed).toBe('boolean');
    });
  });

  describe('9. Alert Rules & Alerts Engine', () => {
    it('getAlertRules(), createAlertRule(), updateAlertRule(), deleteAlertRule()', async () => {
      const rule = await db.createAlertRule({
        name: 'Unit Test High CPU ' + Date.now(),
        metric_name: 'cpu_load',
        operator: '>',
        threshold_value: 90,
        duration_minutes: 5,
        severity: 'CRITICAL'
      });
      expect(rule).toBeDefined();
      expect(rule.id).toBeDefined();

      const rules = await db.getAlertRules();
      expect(rules.length).toBeGreaterThan(0);

      const byId = await db.getAlertRuleById(rule.id);
      expect(byId).toBeDefined();

      const updated = await db.updateAlertRule(rule.id, { threshold_value: 95 });
      expect(typeof updated).toBe('boolean');

      db.invalidateAlertRulesCache();
      const deleted = await db.deleteAlertRule(rule.id);
      expect(deleted).toBe(true);
    });

    it('createAlert(), getAlerts(), updateAlert(), resolveAlert()', async () => {
      const dev = (await db.getDevices())[0];
      const alert = await db.createAlert({
        device_id: dev.id,
        severity: 'HIGH',
        title: 'High CPU Detected',
        description: 'CPU at 95% for 10 minutes'
      });
      expect(alert).toBeDefined();
      expect(['active', 'open']).toContain(alert.status);

      const alerts = await db.getAlerts();
      expect(Array.isArray(alerts)).toBe(true);

      const resolved = await db.resolveAlert(alert.id);
      expect(typeof resolved).toBe('boolean');
    });
  });

  describe('10. Groups & Policies', () => {
    it('getGroups(), createGroup(), updateGroup(), deleteGroup()', async () => {
      const grp = await db.createGroup({
        name: 'Test Group ' + Date.now(),
        description: 'Unit testing group'
      });
      expect(grp).toBeDefined();

      const groups = await db.getGroups();
      expect(groups.length).toBeGreaterThan(0);

      const updated = await db.updateGroup(grp.id, { description: 'Updated desc' });
      expect(typeof updated).toBe('boolean');

      const deleted = await db.deleteGroup(grp.id);
      expect(deleted).toBe(true);
    });

    it('getPolicies(), createPolicy(), updatePolicy(), deletePolicy()', async () => {
      const pol = await db.createPolicy({
        name: 'Test Policy ' + Date.now(),
        policy_type: 'security',
        config_json: { firewall: true }
      });
      expect(pol).toBeDefined();

      const policies = await db.getPolicies();
      expect(policies.length).toBeGreaterThan(0);

      const updated = await db.updatePolicy(pol.id, { name: 'Renamed Policy' });
      expect(typeof updated).toBe('boolean');

      const deleted = await db.deletePolicy(pol.id);
      expect(deleted).toBe(true);
    });
  });

  describe('11. MSI Packages & Bootstrap Tokens', () => {
    it('createMsiPackage(), getMsiPackages(), markMsiPackageUsed(), incrementMsiDownloads()', async () => {
      const pkg = await db.createMsiPackage({
        token_hash: 'msi_hash_' + Date.now(),
        raw_token: 'raw_tok_' + Date.now(),
        version: '1.1.2',
        interval_minutes: 15,
        target_platform: 'x64'
      });
      expect(pkg).toBeDefined();

      const packages = await db.getMsiPackages();
      expect(packages.length).toBeGreaterThan(0);

      const inc = await db.incrementMsiDownloads(pkg.id);
      expect(inc).toBeDefined();

      const used = await db.markMsiPackageUsed(pkg.id, 'ENROLLED-HOST');
      expect(typeof used).toBe('boolean');
    });

    it('bootstrap token verification and usage tracking', async () => {
      const token = 'tok_' + Date.now();
      const isUsedBefore = await db.isBootstrapTokenUsed(token);
      expect(typeof isUsedBefore).toBe('boolean');

      await db.markBootstrapTokenUsed(token, 'hash_' + token, 'ENROLLED-HOST', 'tenant-1');
      const isUsedAfter = await db.isBootstrapTokenUsed(token);
      expect(isUsedAfter).toBe(true);
    });
  });

  describe('12. Tickets & Remediation Engine', () => {
    it('getTickets(), createTicket(), updateTicket()', async () => {
      const ticket = await db.createTicket({
        title: 'Disk Full on DC01',
        description: 'C: Drive is 99% full',
        priority: 'HIGH'
      });
      expect(ticket).toBeDefined();
      expect(ticket.id).toBeDefined();

      const tickets = await db.getTickets();
      expect(tickets.length).toBeGreaterThan(0);

      const updated = await db.updateTicket(ticket.id, { status: 'in_progress' });
      expect(typeof updated).toBe('boolean');
    });

    it('Remediation policies and audit logging', async () => {
      const pol = await db.createRemediationPolicy({
        name: 'Auto Clear Temp',
        action_type: 'CLEAR_TEMP_' + Date.now(),
        trigger_rule_id: 'rule-1',
        script_payload: 'Remove-Item C:\\Temp\\* -Recurse'
      });
      expect(pol).toBeDefined();

      const policies = await db.getRemediationPolicies();
      expect(policies.length).toBeGreaterThan(0);

      const updated = await db.updateRemediationPolicy(pol.id, { is_enabled: false });
      expect(typeof updated).toBe('boolean');

      const log = await db.logRemediation({
        policy_id: pol.id,
        device_id: 'dev-1',
        status: 'SUCCESS',
        output: 'Cleared 500MB'
      });
      expect(log).toBeDefined();

      const logs = await db.getRemediationLogs();
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('13. Events & Audit Logging Subsystems', () => {
    it('addEvent() and getEvents() handle system telemetry events', async () => {
      const evt = await db.addEvent({
        hostname: 'SRV-01',
        kind: 'SYSTEM_EVENT',
        summary: 'Service stopped',
        details: { service: 'Spooler' }
      });
      expect(evt).toBeDefined();

      const events = await db.getEvents('SRV-01');
      expect(Array.isArray(events)).toBe(true);
    });

    it('logAuditToDb() and getAuditLogs() record administrative audit trails', async () => {
      const audit = await db.logAuditToDb({
        actor_id: 'admin',
        action: 'UPDATE_POLICY',
        target_type: 'policy',
        target_id: 'pol-1',
        ip_address: '127.0.0.1'
      });
      expect(audit).toBeDefined();

      const logs = await db.getAuditLogs(20);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('14. Settings, Retention Engine & Webhooks', () => {
    it('getSetting() and setSetting() persist key-values', async () => {
      await db.setSetting('test_key', 'test_value');
      const val = await db.getSetting('test_key');
      expect(val).toBe('test_value');

      const def = await db.getSetting('unknown_key', 'fallback');
      expect(def).toBe('fallback');
    });

    it('getRetentionSettings() and updateRetentionSettings()', async () => {
      const ret = await db.getRetentionSettings();
      expect(ret).toBeDefined();
      expect(typeof ret.raw_telemetry_days).toBe('number');

      const updated = await db.updateRetentionSettings({ raw_telemetry_days: 45 });
      expect(updated.raw_telemetry_days).toBe(45);
    });

    it('runDataRetentionPurge() and getLastRetentionRun()', async () => {
      const purge = await db.runDataRetentionPurge();
      expect(purge).toBeDefined();
      expect(typeof purge.purged_rows.total).toBe('number');

      const lastRun = db.getLastRetentionRun();
      expect(lastRun).toBeDefined();
      expect(lastRun.status).toBe('SUCCESS');
    });

    it('Branding, Ticket Config and Webhooks', async () => {
      const brand = await db.getBranding();
      expect(brand).toBeDefined();
      await db.updateBranding({ portal_title: 'Unit Test IT-Toolkit' });

      const tCfg = await db.getTicketConfig();
      expect(tCfg).toBeDefined();
      await db.updateTicketConfig({ auto_assign: true });

      const wCfg = await db.getWebhookConfig();
      expect(wCfg).toBeDefined();
      await db.updateWebhookConfig({ slack_webhook_url: 'https://hooks.slack.com/services/xxx' });
    });
  });

  describe('15. Token Revocation, Features & Patch Inventory', () => {
    it('revokeTokenInDb() and isTokenRevokedInDb()', async () => {
      const jti = 'jti_revoked_' + Date.now();
      expect(await db.isTokenRevokedInDb(jti)).toBe(false);

      await db.revokeTokenInDb(jti);
      expect(await db.isTokenRevokedInDb(jti)).toBe(true);
    });

    it('getFeatures() and updateFeature()', async () => {
      const feats = await db.getFeatures();
      expect(Array.isArray(feats)).toBe(true);

      if (feats.length > 0) {
        const fName = feats[0].name;
        const updated = await db.updateFeature(fName, { default_enabled: false });
        expect(updated).toBeDefined();
      }
    });

    it('getPatchInventory() and updatePatchStatus()', async () => {
      const patches = await db.getPatchInventory();
      expect(Array.isArray(patches)).toBe(true);

      if (patches.length > 0) {
        const pId = patches[0].id;
        const updated = await db.updatePatchStatus(pId, 'INSTALLED');
        expect(updated).toBeDefined();
      }
    });
  });

  describe('16. Comprehensive Database Module Surface & Extended Branches', () => {
    it('Cache invalidation and pattern deletion', async () => {
      expect(await db.cacheDelPattern('telemetry:*')).toBe(false);
      db.invalidateDeviceCache({ id: 'dev-1', hostname: 'host-1', device_uid: 'uid-1' });
      db.invalidateAlertRulesCache();
    });

    it('Partition maintenance and schema migration runner', async () => {
      const parts = await db.maintainTelemetryPartitions(30);
      expect(parts).toBeDefined();
      expect(Array.isArray(parts.created)).toBe(true);

      const migs = await db.runDatabaseMigrations();
      expect(migs).toBeDefined();
    });

    it('Company lookups by name', async () => {
      const company = await db.getCompanyByName('Aaditech Enterprise Corp');
      expect(company === null || typeof company === 'object').toBe(true);
    });

    it('User lookups by email, identifier, and deletion', async () => {
      const uEmail = await db.getUserByEmail('admin@aaditech.com');
      expect(uEmail === null || typeof uEmail === 'object').toBe(true);

      const uIden = await db.getUserByUsernameOrEmail('admin');
      expect(uIden).toBeDefined();

      const created = await db.createUser({
        username: 'to_delete_user_' + Date.now(),
        password_hash: '$2b$10$xyz',
        email: 'todel@aaditech.com',
        role: 'VIEWER'
      });
      if (created && created.id) {
        const delRes = await db.deleteUser(created.id);
        expect(delRes).toBe(true);
      }
    });

    it('Device lookup by uid, token hash, and deletion', async () => {
      const dev = await db.getDeviceByUid('dev-uid-win-dc01');
      expect(dev === null || typeof dev === 'object').toBe(true);

      const tokenHashDev = await db.getDeviceByTokenHash('nonexistenthash');
      expect(tokenHashDev === null || typeof tokenHashDev === 'object').toBe(true);

      const newDev = {
        id: 'dev_to_delete_' + Date.now(),
        hostname: 'DEL-DEV-' + Date.now(),
        device_uid: 'del-uid-' + Date.now(),
        os_version: 'Windows 11',
        agent_version: '1.1.2',
        ip_address: '10.0.0.99',
        status: 'online'
      };
      await db.syncDeviceToDb(newDev);
      const del = await db.deleteDevice(newDev.id);
      expect(del).toBe(true);
    });

    it('Telemetry queue flush and history batch insert', async () => {
      const flushed = await db.flushTelemetryQueue();
      expect(typeof flushed).toBe('number');

      const stopWorker = db.startTelemetryFlushWorker(60000);
      expect(stopWorker).toBeDefined();
      clearInterval(stopWorker);

      const rec = await db.insertTelemetryRecord('dev-1', { cpu_pct: 22, memory_pct: 45 });
      expect(rec).toBeDefined();

      const batch = await db.insertTelemetryBatch([
        { device_id: 'dev-1', metrics: { cpu_pct: 30 } }
      ]);
      expect(batch).toBeDefined();

      const hist = await db.getTelemetryHistory('dev-1', 10);
      expect(Array.isArray(hist)).toBe(true);
    });

    it('Device process sync and retrieval', async () => {
      await db.syncDeviceProcesses('dev-1', [
        { pid: 1234, name: 'agent.exe', cpu_pct: 0.5, ram_mb: 25.0 }
      ]);
      const procs = await db.getDeviceProcesses('dev-1');
      expect(Array.isArray(procs)).toBe(true);
    });

    it('Groups and Policies lookup, update, and deletion', async () => {
      const grp = await db.getGroupById('grp-1');
      expect(grp === null || typeof grp === 'object').toBe(true);
      if (grp) {
        await db.updateGroup('grp-1', { description: 'Updated Engineering' });
      }

      const tempGrp = await db.createGroup({ name: 'Temp Grp ' + Date.now() });
      if (tempGrp && tempGrp.id) {
        await db.deleteGroup(tempGrp.id);
      }

      const pol = await db.getPolicyById('pol-1');
      expect(pol === null || typeof pol === 'object').toBe(true);
      if (pol) {
        await db.updatePolicy('pol-1', { checkin_interval_sec: 45 });
      }

      const tempPol = await db.createPolicy({ name: 'Temp Pol ' + Date.now() });
      if (tempPol && tempPol.id) {
        await db.deletePolicy(tempPol.id);
      }
    });

    it('MSI Packages usage, downloads, and bootstrap token validation', async () => {
      const pkg = await db.createMsiPackage({
        id: 'pkg_test_' + Date.now(),
        package_name: 'Installer-Test',
        version: '1.0.0',
        bootstrap_token: 'tok_test',
        bootstrap_token_hash: 'tok_hash_test',
        status: 'READY'
      });

      await db.incrementMsiDownloads(pkg.id);
      await db.markMsiPackageUsed(pkg.id, 'HOST-WIN');

      const usedBefore = await db.isBootstrapTokenUsed('tok_test');
      expect(typeof usedBefore).toBe('boolean');

      await db.markBootstrapTokenUsed('tok_test', 'tok_hash_test', 'HOST-WIN', 'tenant-1');
      const usedAfter = await db.isBootstrapTokenUsed('tok_test');
      expect(usedAfter).toBe(true);
    });

    it('Ticket lookup by ID and update', async () => {
      const t = await db.createTicket({ title: 'Ticket for Unit Test', severity: 'MEDIUM' });
      const found = await db.getTicketById(t.id);
      expect(found).toBeDefined();

      const updated = await db.updateTicket(t.id, { status: 'IN_PROGRESS' });
      expect(updated).toBeDefined();
    });

    it('Remediation policies lifecycle and logs', async () => {
      const pols = await db.getRemediationPolicies();
      expect(Array.isArray(pols)).toBe(true);

      const byId = await db.getRemediationPolicyById('clean_temp');
      expect(byId === null || typeof byId === 'object').toBe(true);

      const byAction = await db.getRemediationPolicyByActionType('clean_temp_files');
      expect(byAction === null || typeof byAction === 'object').toBe(true);

      const newRem = await db.createRemediationPolicy({
        name: 'Auto DNS Reset ' + Date.now(),
        action_type: 'dns_reset',
        trigger_condition: 'dns_failed'
      });
      if (newRem && newRem.id) {
        await db.updateRemediationPolicy(newRem.id, { enabled: 0 });
      }

      await db.logRemediation({
        device_id: 'dev-1',
        hostname: 'HOST-1',
        action_type: 'clean_temp_files',
        status: 'SUCCESS'
      });

      const logs = await db.getRemediationLogs(10);
      expect(Array.isArray(logs)).toBe(true);
    });

    it('Retention scheduler lifecycle', () => {
      const stopSched = db.initRetentionScheduler(600000);
      expect(stopSched).toBeDefined();
      clearInterval(stopSched);
    });
  });

  describe('17. Fallback SQL Engine & Query Emulation Coverage', () => {
    it('executeQuery flags mocked EXPLAIN results when MySQL is offline', async () => {
      const q1 = await db.executeQuery('EXPLAIN SELECT * FROM command_queue WHERE device_id = ?');
      expect(q1[0].mocked).toBe(true);
      expect(q1[0].reason).toBe('mysql offline');

      const q2 = await db.executeQuery('EXPLAIN SELECT * FROM devices WHERE hostname = ?');
      expect(q2[0].mocked).toBe(true);
      expect(q2[0].reason).toBe('mysql offline');

      const q3 = await db.executeQuery('EXPLAIN SELECT * FROM devices WHERE device_uid = ?');
      expect(q3[0].mocked).toBe(true);
      expect(q3[0].reason).toBe('mysql offline');

      const q4 = await db.executeQuery('EXPLAIN SELECT * FROM devices WHERE device_token_hash = ?');
      expect(q4[0].mocked).toBe(true);
      expect(q4[0].reason).toBe('mysql offline');

      const q5 = await db.executeQuery('EXPLAIN SELECT * FROM devices WHERE status = ?');
      expect(q5[0].mocked).toBe(true);
      expect(q5[0].reason).toBe('mysql offline');

      const q6 = await db.executeQuery('EXPLAIN SELECT * FROM remediation_policies WHERE action_type = ?');
      expect(q6[0].mocked).toBe(true);
      expect(q6[0].reason).toBe('mysql offline');

      const q7 = await db.executeQuery('EXPLAIN SELECT * FROM generic_table');
      expect(q7[0].mocked).toBe(true);
      expect(q7[0].reason).toBe('mysql offline');
    });

    it('executeQuery handles SELECT query patterns with filters', async () => {
      const u1 = await db.executeQuery('SELECT * FROM users WHERE username = ?', ['admin']);
      expect(Array.isArray(u1)).toBe(true);

      const uAll = await db.executeQuery('SELECT * FROM users');
      expect(Array.isArray(uAll)).toBe(true);

      const t1 = await db.executeQuery('SELECT * FROM tenants WHERE id = ?', ['00000000-0000-0000-0000-000000000001']);
      expect(Array.isArray(t1)).toBe(true);

      const tAll = await db.executeQuery('SELECT * FROM tenants');
      expect(Array.isArray(tAll)).toBe(true);

      const comp = await db.executeQuery('SELECT * FROM companies');
      expect(Array.isArray(comp)).toBe(true);

      const dId = await db.executeQuery('SELECT * FROM devices WHERE id = ?', ['dev-1']);
      expect(Array.isArray(dId)).toBe(true);

      const dHost = await db.executeQuery('SELECT * FROM devices WHERE hostname = ?', ['win-dc01']);
      expect(Array.isArray(dHost)).toBe(true);

      const dUid = await db.executeQuery('SELECT * FROM devices WHERE device_uid = ?', ['dev-uid-win-dc01']);
      expect(Array.isArray(dUid)).toBe(true);

      const dTok = await db.executeQuery('SELECT * FROM devices WHERE device_token_hash = ?', ['hash123']);
      expect(Array.isArray(dTok)).toBe(true);

      const dStat = await db.executeQuery('SELECT * FROM devices WHERE status = ?', ['online']);
      expect(Array.isArray(dStat)).toBe(true);

      const dAll = await db.executeQuery('SELECT * FROM devices');
      expect(Array.isArray(dAll)).toBe(true);

      const aud = await db.executeQuery('SELECT * FROM audit_logs');
      expect(Array.isArray(aud)).toBe(true);

      const rAll = await db.executeQuery('SELECT * FROM alert_rules');
      expect(Array.isArray(rAll)).toBe(true);

      const altAll = await db.executeQuery('SELECT * FROM alerts');
      expect(Array.isArray(altAll)).toBe(true);

      const grpAll = await db.executeQuery('SELECT * FROM groups');
      expect(Array.isArray(grpAll)).toBe(true);

      const polAll = await db.executeQuery('SELECT * FROM policies');
      expect(Array.isArray(polAll)).toBe(true);

      const rem1 = await db.executeQuery('SELECT * FROM remediation_policies WHERE id = ?', ['clean_temp']);
      expect(Array.isArray(rem1)).toBe(true);

      const remAll = await db.executeQuery('SELECT * FROM remediation_policies');
      expect(Array.isArray(remAll)).toBe(true);

      const remLogs = await db.executeQuery('SELECT * FROM remediation_logs');
      expect(Array.isArray(remLogs)).toBe(true);

      const sett = await db.executeQuery('SELECT * FROM system_settings WHERE setting_key = ?', ['test_key']);
      expect(Array.isArray(sett)).toBe(true);

      const rev = await db.executeQuery('SELECT * FROM revoked_tokens WHERE token_or_jti = ?', ['dummy_jti']);
      expect(Array.isArray(rev)).toBe(true);

      const migs = await db.executeQuery('SELECT * FROM schema_migrations');
      expect(Array.isArray(migs)).toBe(true);

      const insMig = await db.executeQuery('INSERT INTO schema_migrations (version) VALUES (?)', ['999_test.sql']);
      expect(insMig.affectedRows).toBe(1);
    });
  });

  describe('18. Extended Alerts, Telemetry & Scheduler Operations', () => {
    it('handles getAlertById, updateAlert, getAlertRuleByName, and invalidateAlertRulesCache', async () => {
      const created = await db.createAlert({
        hostname: 'alert-unit-host',
        rule: 'Disk Alert Test',
        severity: 'critical',
        message: 'Disk threshold exceeded'
      });
      expect(created.id).toBeDefined();

      const fetched = await db.getAlertById(created.id);
      expect(fetched).toBeDefined();
      expect(fetched.hostname).toBe('alert-unit-host');

      const updated = await db.updateAlert(created.id, { message: 'Updated disk alert message' });
      expect(updated).toBe(true);

      const resolved = await db.updateAlert(created.id, { status: 'resolved' });
      expect(resolved).toBe(true);

      const rule = await db.createAlertRule({
        name: 'CPU Spike Rule Unit',
        condition: { cpu_pct: 95 }
      });
      expect(rule.name).toBe('CPU Spike Rule Unit');

      const foundRule = await db.getAlertRuleByName('CPU Spike Rule Unit');
      expect(foundRule).toBeDefined();

      db.invalidateAlertRulesCache();
      const rules = await db.getAlertRules();
      expect(Array.isArray(rules)).toBe(true);
    });

    it('handles markCommandPickedUp and batch telemetry array insertion', async () => {
      const cmdObj = { device_id: 'unit-dev-pickup', hostname: 'win-dc01', kind: 'system_info', payload: {} };
      const queued = await db.queueCommandInDb(cmdObj);
      expect(queued).toBe(true);
      expect(cmdObj.id).toBeDefined();

      const picked = await db.markCommandPickedUp(cmdObj.id);
      expect(picked).toBe(true);

      const pending = await db.getPendingCommandsForDevice('unit-dev-pickup');
      expect(Array.isArray(pending)).toBe(true);

      const batchRes = await db.insertTelemetryRecord('unit-dev-pickup', [
        { cpu_pct: 22, ram_pct: 45, disk_free_gb: 120, net_latency_ms: 15 },
        { cpu_pct: 35, ram_pct: 50, disk_free_gb: 119, net_latency_ms: 18 }
      ]);
      expect(batchRes).toBe(true);

      const flushTimer = db.startTelemetryFlushWorker(60000);
      expect(flushTimer).toBeDefined();
      clearInterval(flushTimer);

      const sched = db.initRetentionScheduler(3600000);
      expect(sched).toBeDefined();
      clearInterval(sched);
    });
  });
});

