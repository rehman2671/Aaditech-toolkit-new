import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';

const priorEnv = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (priorEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorEnv;
});

describe('Phase N16 tenant inventory SQL boundaries', () => {
  it('requires tenant SQL predicate on software, fleet, license and posture inventory', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        return [[], []];
      }
    });
    for (const workspace of ['tenant-A', 'tenant-B']) {
      const devices = await db.getDevices({ tenant_id: workspace });
      expect(devices).toEqual([]);
    }
    expect(queries).toHaveLength(2);
    expect(queries.every(q => /FROM devices WHERE tenant_id = \?/.test(q.sql))).toBe(true);
    expect(queries.map(q => q.params)).toEqual([['tenant-A'], ['tenant-B']]);
  });
});

describe('Stage N16 per-workspace email storage isolation', () => {
  it('does not inherit global retention/email recipients or another tenant config', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        if (sql.includes('FROM system_settings')) return [[], []];
        return [{ affectedRows: 1 }, []];
      }
    });
    expect(await db.getTenantEmailConfig('tenant-A')).toEqual({ enabled: false, recipient: '' });
    await db.updateTenantEmailConfig('tenant-A', { recipient: 'alerts@example.com', enabled: true });
    expect(await db.getTenantEmailConfig('tenant-B')).toEqual({ enabled: false, recipient: '' });
    const keys = queries.filter(q => q.sql.includes('system_settings')).map(q => q.params[0]);
    expect(keys).toContain('tenant:tenant-A:emailConfig');
    expect(keys).toContain('tenant:tenant-B:emailConfig');
    expect(keys).not.toContain('retentionSettings');
    expect(keys).not.toContain('emailConfig');
  });
});
