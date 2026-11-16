import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';

const original = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (original === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original;
});

describe('Stage 14 tenant-scoped ticket and branding configuration', () => {
  it('queries tickets by authenticated workspace in MySQL', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      queries.push({ sql, params });
      return [[], []];
    }});
    const tickets = await db.getTickets('tenant-A');
    expect(tickets).toEqual([]);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/FROM tickets WHERE tenant_id = \?/);
    expect(queries[0].params).toEqual(['tenant-A']);
  });

  it('keeps ticket config isolated with no global integration inheritance', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM system_settings')) return [[], []];
      return [{ affectedRows: 1 }, []];
    }});
    const before = await db.getTenantTicketConfig('tenant-A');
    expect(before).toMatchObject({ system: 'none', url: '', auto_create_on_critical: false });
    const edited = await db.updateTenantTicketConfig('tenant-A', { system: 'jira', project: 'ABC' });
    expect(edited).toMatchObject({ system: 'jira', project: 'ABC' });
    const keys = queries.filter(q => q.sql.includes('system_settings')).map(q => q.params[0]);
    expect(keys.every(k => k === 'tenant:tenant-A:ticketConfig')).toBe(true);
    expect(keys).not.toContain('ticketConfig');
  });

  it('only updates workspace presentation keys, never global server branding', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM system_settings')) return [[], []];
      return [{ affectedRows: 1 }, []];
    }});
    const result = await db.updateTenantBranding('tenant-B',
      { color: '#112233', logo_text: 'B Corp' });
    expect(result.color).toBe('#112233');
    expect(queries.filter(q => q.sql.includes('system_settings'))
      .every(q => q.params[0] === 'tenant:tenant-B:branding')).toBe(true);
  });
});
