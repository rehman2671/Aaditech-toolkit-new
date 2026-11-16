import { describe, it, expect, vi } from 'vitest';
import { deliverOutboxEntry, runNotificationOutboxBatch } from '../../notification-outbox.js';

describe('Stage N17 durable tenant notification worker', () => {
  const emailRow = { id: 7, tenant_id: 'tenant-A', channel: 'email', attempts: 1,
    lease_token: 'lease-A', payload_json: JSON.stringify({ title: 'Disk warning', message: '10GB', severity: 'warning' }) };
  it('skips disabled or malformed targets without outbound calls', async () => {
    const sendEmail = vi.fn(async () => ({ accepted: true }));
    const disabled = await deliverOutboxEntry(emailRow, {
      getEmailConfig: async () => ({ enabled: false }), sendEmail
    });
    expect(disabled).toMatchObject({ outcome: 'SKIPPED', reason: 'DISABLED' });
    const malformed = await deliverOutboxEntry({ ...emailRow, payload_json: '{oops' }, { sendEmail });
    expect(malformed).toMatchObject({ outcome: 'SKIPPED', reason: 'INVALID_OUTBOX_PAYLOAD' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('dispatches only the configured tenant and records relay acceptance', async () => {
    const getEmailConfig = vi.fn(async t => ({ enabled: t === 'tenant-A', recipient: 'alerts@example.com' }));
    const sendEmail = vi.fn(async () => ({ accepted: true }));
    expect(await deliverOutboxEntry(emailRow, { getEmailConfig, sendEmail }))
      .toMatchObject({ outcome: 'DELIVERED' });
    expect(sendEmail).toHaveBeenCalledWith('tenant-A', { enabled: true, recipient: 'alerts@example.com' },
      { title: 'Disk warning', message: '10GB', severity: 'warning' });
    expect((await deliverOutboxEntry({ ...emailRow, tenant_id: 'tenant-B' },
      { getEmailConfig, sendEmail })).outcome).toBe('SKIPPED');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  it('handles transient failures via retry and does not fabricate delivery', async () => {
    expect(await deliverOutboxEntry(emailRow, {
      getEmailConfig: async () => ({ enabled: true, recipient: 'alerts@example.com' }),
      sendEmail: async () => ({ accepted: false, reason: 'SMTP_NOT_CONFIGURED' })
    })).toMatchObject({ outcome: 'RETRY' });
    await expect(deliverOutboxEntry({ ...emailRow, channel: 'webhook' }, {
      getWebhookConfig: async () => ({ enabled: true, url: 'https://hooks.slack.com/x' }),
      sendWebhook: async () => { throw new Error('offline'); }
    })).rejects.toThrow('offline');
  });
  it('acknowledges only leased claimed rows, retries failures, skips disabled jobs', async () => {
    const complete = vi.fn(async () => true);
    const retry = vi.fn(async () => true);
    const rows = [
      emailRow,
      { ...emailRow, id: 8, channel: 'webhook', lease_token: 'lease-B' },
      { ...emailRow, id: 9, tenant_id: 'tenant-B', lease_token: 'lease-C' }
    ];
    const result = await runNotificationOutboxBatch({
      claim: async () => rows, complete, retry,
      getEmailConfig: async t => ({ enabled: t === 'tenant-A', recipient: 'alerts@example.com' }),
      getWebhookConfig: async () => ({ enabled: true, url: 'https://hooks.slack.com/x' }),
      sendEmail: async () => ({ accepted: true }),
      sendWebhook: async () => ({ dispatched: false, reason: 'UPSTREAM_503' })
    });
    expect(result).toEqual({ processed: 3, delivered: 1, skipped: 1, retried: 1 });
    expect(complete).toHaveBeenCalledWith(7, 'lease-A', 'DELIVERED');
    expect(complete).toHaveBeenCalledWith(9, 'lease-C', 'SKIPPED');
    expect(retry).toHaveBeenCalledWith(rows[1], 'WEBHOOK_DELIVERY_FAILED');
  });
});

describe('Stage N17 MySQL outbox transactional SQL contract', () => {
  it('leaves delivery permanently uncommitted after SQL enqueue failure', async () => {
    const db = await import('../../db.js');
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const actions = [];
    const connection = {
      beginTransaction: async () => actions.push('begin'),
      query: async sql => {
        actions.push(sql.trim().startsWith('INSERT INTO alerts') ? 'alert'
          : sql.trim().startsWith('INSERT IGNORE INTO notification_outbox') ? 'job' : 'unexpected');
        if (sql.includes('notification_outbox')) throw new Error('SQL_OUTBOX_WRITE_FAILED');
        return [{ insertId: 14, affectedRows: 1 }, []];
      },
      commit: async () => actions.push('commit'),
      rollback: async () => actions.push('rollback'),
      release: () => actions.push('release')
    };
    db.setConnectionStateForTesting(true, { getConnection: async () => connection });
    try {
      await expect(db.createAlert({ tenant_id: 'tenant-A', device_id: 'PC-1',
        hostname: 'PC-1', rule: 'CPU overload' }, [
          { channel: 'email', event: { title: 'CPU alert' } }
        ])).rejects.toThrow('SQL_OUTBOX_WRITE_FAILED');
      expect(actions).toEqual(['begin', 'alert', 'job', 'rollback', 'release']);
    } finally {
      db.setConnectionStateForTesting(false, null);
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;
    }
  });
  it('atomically records both selected channels and commits only once', async () => {
    const db = await import('../../db.js');
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const calls = [];
    const connection = {
      beginTransaction: async () => calls.push('begin'),
      query: async (sql, params) => {
        calls.push({ sql, params });
        return [{ insertId: 20, affectedRows: 1 }, []];
      },
      commit: async () => calls.push('commit'),
      rollback: async () => calls.push('rollback'),
      release: () => calls.push('release')
    };
    db.setConnectionStateForTesting(true, { getConnection: async () => connection });
    try {
      const alert = await db.createAlert({ tenant_id: 'tenant-A', device_id: 'PC-1' }, [
        { channel: 'webhook', event: { title: 'CPU' } },
        { channel: 'email', event: { title: 'CPU' } }
      ]);
      expect(alert.id).toBe(20);
      expect(calls.filter(c => c === 'commit')).toHaveLength(1);
      expect(calls.filter(c => c === 'rollback')).toHaveLength(0);
      const inserts = calls.filter(c => typeof c === 'object' && c.sql.includes('notification_outbox'));
      expect(inserts.map(x => x.params.slice(0, 3))).toEqual([
        ['tenant-A', 20, 'webhook'], ['tenant-A', 20, 'email']
      ]);
    } finally {
      db.setConnectionStateForTesting(false, null);
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;
    }
  });
});
