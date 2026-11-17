import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';

const prior = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (prior === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prior;
});

describe('Phase N12 production tenant-scoped user/company/event SQL', () => {
  it('requires a tenant predicate on user and company inventory', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        return [[], []];
      }
    });
    await db.getUsers('tenant-security-1');
    await db.getCompanies('tenant-security-1');
    expect(queries[0].sql).toMatch(/FROM users WHERE tenant_id = \?/);
    expect(queries[0].params).toEqual(['tenant-security-1']);
    expect(queries[1].sql).toMatch(/FROM companies WHERE tenant_id = \?/);
    expect(queries[1].params).toEqual(['tenant-security-1']);
  });
  it('reads only tenant-bound events without non-unique hostname joins', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params) => { queries.push({sql, params}); return [[], []]; }
    });
    await db.getEvents('WINDOWS-1', 30, 'telemetry', 'tenant-security-1');
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).not.toMatch(/JOIN devices|d.hostname|d.tenant_id/i);
    expect(queries[0].sql).toContain('FROM events WHERE tenant_id = ?');
    expect(queries[0].params).toEqual(['tenant-security-1', 'WINDOWS-1', 'telemetry', 30]);
  });
});
