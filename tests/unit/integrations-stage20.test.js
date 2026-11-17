import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';
import { ticketConfigSchema } from '../../validation.js';

const savedMode = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (savedMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedMode;
});

describe('Stage N20 ticket credentials and truthful connector status', () => {
  it('never accepts secret-bearing browser ticket settings', () => {
    expect(ticketConfigSchema.safeParse({ system: 'jira', url: 'https://acme.atlassian.net',
      project: 'ITSUP' }).success).toBe(true);
    expect(ticketConfigSchema.safeParse({ system: 'jira', api_key: 'secret' }).success).toBe(false);
    expect(ticketConfigSchema.safeParse({ system: 'jira', url: 'http://insecure.local' }).success).toBe(false);
    expect(ticketConfigSchema.safeParse({ system: 'jira', url: 'https://example.com',
      extra_secret: 'not allowed' }).success).toBe(false);
  });

  it('redacts historical ticket API keys even before migration 008', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM system_settings')) {
        return [[{ setting_value: JSON.stringify({
          system: 'jira', api_key: 'historical-secret-value', project: 'ABC'
        }) }], []];
      }
      return [{ affectedRows: 1 }, []];
    }});
    const config = await db.getTenantTicketConfig('tenant-A');
    expect(config.system).toBe('jira');
    expect(config.project).toBe('ABC');
    expect(JSON.stringify(config)).not.toContain('historical-secret-value');
    expect(config).not.toHaveProperty('api_key');
    await expect(db.updateTenantTicketConfig('tenant-A', { api_key: 'injected' }))
      .rejects.toThrow('BROWSER_CREDENTIALS_NOT_ALLOWED');
    expect(queries.every(q => !q.sql.startsWith('UPDATE'))).toBe(true);
  });

  it('stores ticket metadata under a single tenant setting only', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM system_settings')) return [[], []];
      return [{ affectedRows: 1 }, []];
    }});
    const config = await db.updateTenantTicketConfig('tenant-A',
      { system: 'servicenow', project: 'SVC' });
    expect(config).toMatchObject({ system: 'servicenow', project: 'SVC' });
    expect(queries.filter(q => q.sql.includes('system_settings'))
      .every(q => q.params[0] === 'tenant:tenant-A:ticketConfig')).toBe(true);
  });
});
