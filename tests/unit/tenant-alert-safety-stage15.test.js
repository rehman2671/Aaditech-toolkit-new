import { describe, it, expect, vi, afterEach } from 'vitest';
import * as db from '../../db.js';
import { scopedAlertRules, isApprovedWebhookUrl, deliverTenantWebhook } from '../../tenant-alert-safety.js';

const originalEnv = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (originalEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv;
});

describe('Stage N15 tenant alert isolation and safe outbound delivery', () => {
  it('only evaluates enabled alert rules belonging to the actual agent tenant', () => {
    const rules = [
      { tenant_id: 'tenant-A', enabled: true, name: 'A' },
      { tenant_id: 'tenant-B', enabled: true, name: 'B' },
      { tenant_id: 'tenant-A', enabled: false, name: 'disabled' },
      { enabled: true, name: 'legacy-unscoped' }
    ];
    expect(scopedAlertRules('tenant-A', rules).map(rule => rule.name)).toEqual(['A']);
    expect(scopedAlertRules('tenant-B', rules).map(rule => rule.name)).toEqual(['B']);
    expect(scopedAlertRules(undefined, rules)).toEqual([]);
  });

  it('rejects unapproved, plaintext, private and lookalike webhook addresses', () => {
    const list = 'hooks.slack.com,alerts.example.com';
    expect(isApprovedWebhookUrl('https://hooks.slack.com/services/A/B', list)).toBe(true);
    for (const url of [
      'http://hooks.slack.com/path', 'https://hooks.slack.com.evil.test/path',
      'https://127.0.0.1/x', 'https://user@hooks.slack.com/x',
      'https://hooks.slack.com/path#fragment', 'https://localhost/x',
      'https://alerts.example.com/path'
    ]) {
      expect(isApprovedWebhookUrl(url, 'hooks.slack.com')).toBe(false);
    }
    expect(isApprovedWebhookUrl('https://hooks.slack.com/path', '')).toBe(false);
  });

  it('never calls fetch without explicit tenant consent and exact host approval', async () => {
    const sender = vi.fn(async () => ({ ok: true, status: 204 }));
    const config = { enabled: true, url: 'https://hooks.slack.com/services/X', type: 'slack' };
    expect((await deliverTenantWebhook('tenant-A', { ...config, enabled: false }, {}, sender, 'hooks.slack.com')).dispatched).toBe(false);
    expect((await deliverTenantWebhook('tenant-A', config, {}, sender, '')).dispatched).toBe(false);
    expect((await deliverTenantWebhook(null, config, {}, sender, 'hooks.slack.com')).dispatched).toBe(false);
    expect(sender).not.toHaveBeenCalled();
    const result = await deliverTenantWebhook('tenant-A', config,
      { title: 'CPU alert', message: 'Above threshold', severity: 'warning' }, sender, 'hooks.slack.com');
    expect(result).toMatchObject({ dispatched: true, status_code: 204 });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' });
  });

  it('reads and writes tenant webhook config without global webhook inheritance', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM system_settings')) return [[], []];
      return [{ affectedRows: 1 }, []];
    } });
    const initial = await db.getTenantWebhookConfig('tenant-A');
    expect(initial).toEqual({ enabled: false, url: '', type: 'generic' });
    await db.updateTenantWebhookConfig('tenant-A', { enabled: true, url: 'https://hooks.slack.com/services/X' });
    const keys = queries.filter(q => q.sql.includes('system_settings')).map(q => q.params[0]);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every(key => key === 'tenant:tenant-A:webhookConfig')).toBe(true);
    expect(keys).not.toContain('webhookConfig');
  });

  it('refuses production alert creation without an explicit device tenant', async () => {
    process.env.NODE_ENV = 'production';
    await expect(db.createAlert({ device_id: 'test-device', hostname: 'TEST' }))
      .rejects.toThrow('TENANT_REQUIRED');
  });
});
