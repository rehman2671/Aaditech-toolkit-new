import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';

const prior = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (prior === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prior;
});

describe('Stage N18 workspace policy and inventory SQL', () => {
  it('requires a tenant predicate for group/policy inventory SQL', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        return [[], []];
      }
    });
    expect(await db.getGroups('tenant-B')).toEqual([]);
    expect(await db.getPolicies('tenant-B')).toEqual([]);
    expect(queries[0].sql).toMatch(/FROM groups WHERE tenant_id = \?/);
    expect(queries[1].sql).toMatch(/FROM policies WHERE tenant_id = \?/);
    expect(queries.map(q => q.params)).toEqual([['tenant-B'], ['tenant-B']]);
  });

  it('patch approval is stored only in current tenant, never platform global key', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        if (sql.includes('FROM system_settings')) return [[], []];
        return [{ affectedRows: 1 }, []];
      }
    });
    const before = await db.getTenantPatchInventory('tenant-A');
    expect(before[0].status).toBe('PENDING_APPROVAL');
    expect(before[0].affected_devices).toBe(0);
    const approved = await db.updateTenantPatchStatus('tenant-A', 'kb-5034441', 'APPROVED');
    expect(approved.status).toBe('APPROVED');
    const different = await db.getTenantPatchInventory('tenant-B');
    expect(different[0].status).toBe('PENDING_APPROVAL');
    const keys = queries.filter(q => q.sql.includes('system_settings')).map(q => q.params[0]);
    expect(keys).toContain('tenant:tenant-A:patchInventory');
    expect(keys).toContain('tenant:tenant-B:patchInventory');
    expect(keys).not.toContain('patchInventory');
  });
});
