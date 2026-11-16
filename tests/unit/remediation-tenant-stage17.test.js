import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';

const prior = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (prior === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prior;
});

describe('Stage N17 remediation tenant containment', () => {
  it('fails closed on missing tenant for log writes and reads', async () => {
    await expect(db.logRemediation({ hostname: 'PC-1', action: 'test' }))
      .rejects.toThrow('TENANT_REQUIRED');
    await expect(db.getRemediationLogs(50))
      .rejects.toThrow('TENANT_REQUIRED');
  });
  it('writes logs with a tenant and restricts read SQL to exact tenant ID', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        if (/^SELECT/i.test(sql.trim())) return [[], []];
        return [{ insertId: 45, affectedRows: 1 }, []];
      }
    });
    const created = await db.logRemediation({
      tenant_id: 'tenant-A', hostname: 'PC-1',
      policy_name: 'Safe policy', action: 'queued', status: 'pending'
    });
    expect(created.tenant_id).toBe('tenant-A');
    await db.getRemediationLogs(50, 'tenant-B');
    expect(queries[0].sql).toMatch(/INSERT INTO remediation_logs \(tenant_id, hostname/);
    expect(queries[0].params[0]).toBe('tenant-A');
    expect(queries[1].sql).toMatch(/FROM remediation_logs WHERE tenant_id = \?/);
    expect(queries[1].params).toEqual(['tenant-B', 50]);
  });
  it('keeps policy toggles in tenant-specific settings, not global templates', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        if (sql.includes('FROM remediation_policies')) return [[{
          id: 'clean_temp', action_type: 'clean_temp_files',
          name: 'Clean temp', enabled: 1
        }], []];
        if (sql.includes('FROM system_settings')) return [[], []];
        return [{ affectedRows: 1 }, []];
      }
    });
    await db.setTenantRemediationPolicyEnabled('tenant-A', 'clean_temp', false);
    await db.getTenantRemediationPolicies('tenant-B');
    const settings = queries.filter(q => q.sql.includes('system_settings'));
    expect(settings.some(q => q.params[0] === 'tenant:tenant-A:remediationPolicyOverrides')).toBe(true);
    expect(settings.some(q => q.params[0] === 'tenant:tenant-B:remediationPolicyOverrides')).toBe(true);
    expect(settings.every(q => q.params[0] !== 'remediationPolicyOverrides')).toBe(true);
    expect(queries.some(q => /^UPDATE remediation_policies/.test(q.sql))).toBe(false);
  });
});
