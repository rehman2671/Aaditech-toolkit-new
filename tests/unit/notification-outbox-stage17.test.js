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
    expect(await deliverOutboxEntry({ ...emailRow, channel: 'webhook' }, {
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
