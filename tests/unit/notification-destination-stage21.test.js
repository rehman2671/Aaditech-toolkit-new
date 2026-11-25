import { describe, expect, it, vi, afterEach } from 'vitest';
import { destinationFingerprint, matchesQueuedDestination } from '../../notification-destination.js';
import { deliverOutboxEntry, runNotificationOutboxBatch } from '../../notification-outbox.js';
import * as db from '../../db.js';

const env = {
  HMAC_SECRET: 'test-key-cryptographically-long-and-unique',
  WEBHOOK_ALLOWED_HOSTS: 'hooks.slack.com',
  SMTP_HOST: 'smtp.example.com',
  SMTP_SECURITY: 'starttls',
  SMTP_PORT: '587',
  SMTP_USER: 'sender@example.com',
  SMTP_PASSWORD: 'test-local-only',
  SMTP_FROM: 'sender@example.com',
  SMTP_ALLOWED_RECIPIENT_DOMAINS: 'example.com',
  SMTP_TIMEOUT_MS: '12000'
};
const tenant = '00000000-0000-0000-0000-000000000001';
const email = { enabled: true, recipient: 'alerts@example.com' };
const webhook = { enabled: true, type: 'slack', url: 'https://hooks.slack.com/services/T/SECRET' };
const event = { title: 'Device warning', message: 'Disk nearly full', severity: 'warning' };
const row = (channel, config) => ({
  id: 5, lease_token: 'lease-1', tenant_id: tenant, channel,
  attempts: 1, destination_hash: destinationFingerprint(tenant, channel, config, env),
  payload_json: JSON.stringify(event)
});
const verification = (message, current) => matchesQueuedDestination(message, current, env);
const savedMode = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (savedMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedMode;
});

describe('Stage N21 destination consent snapshot and outbox lease integrity', () => {
  it('stores only keyed endpoint fingerprint; no URL, password or recipient address', () => {
    const mailHash = destinationFingerprint(tenant, 'email', email, env);
    const hookHash = destinationFingerprint(tenant, 'webhook', webhook, env);
    expect(mailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hookHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mailHash).not.toBe(hookHash);
    expect(mailHash).not.toContain('alerts@example.com');
    expect(hookHash).not.toContain('hooks.slack.com');
    expect(hookHash).not.toContain('SECRET');
    expect(destinationFingerprint(tenant + '-other', 'email', email, env)).not.toBe(mailHash);
    expect(destinationFingerprint(tenant, 'email', email, { ...env, HMAC_SECRET: 'new-operator-secret-string-long' }))
      .not.toBe(mailHash);
  });

  it('rejects altered destinations, missing keys and unapproved endpoints', () => {
    expect(verification(row('webhook', webhook), webhook)).toBe(true);
    expect(verification(row('email', email), email)).toBe(true);
    expect(verification(row('email', email), { ...email, recipient: 'other@example.com' })).toBe(false);
    expect(verification(row('webhook', webhook),
      { ...webhook, url: 'https://hooks.slack.com/services/T/DIFFERENT' })).toBe(false);
    expect(verification({ ...row('email', email), destination_hash: null }, email)).toBe(false);
    expect(destinationFingerprint(tenant, 'webhook',
      { enabled: true, url: 'https://127.0.0.1/private' }, env)).toBeNull();
    expect(destinationFingerprint(tenant, 'email',
      { enabled: true, recipient: 'alerts@other.org' }, env)).toBeNull();
    expect(destinationFingerprint(tenant, 'email', email,
      { ...env, HMAC_SECRET: '' })).toBeNull();
  });

  it('skips pending legacy notifications without destination binding, not sending to newly authorized target', async () => {
    const send = vi.fn(async () => ({ accepted: true }));
    const legacy = { ...row('email', email), destination_hash: null };
    const outcome = await deliverOutboxEntry(legacy, {
      getEmailConfig: async () => email, sendEmail: send, verifyDestination: verification
    });
    expect(outcome).toEqual({ outcome: 'SKIPPED', reason: 'DESTINATION_CHANGED_OR_UNBOUND' });
    expect(send).not.toHaveBeenCalled();
  });

  it('never exports historical tenant alert when recipient or webhook changes after queuing', async () => {
    const sendEmail = vi.fn(async () => ({ accepted: true }));
    const sendWebhook = vi.fn(async () => ({ dispatched: true }));
    const changedMail = await deliverOutboxEntry(row('email', email), {
      getEmailConfig: async () => ({ ...email, recipient: 'changed@example.com' }),
      sendEmail, verifyDestination: verification
    });
    const changedHook = await deliverOutboxEntry(row('webhook', webhook), {
      getWebhookConfig: async () => ({ ...webhook,
        url: 'https://hooks.slack.com/services/T/CHANGED' }),
      sendWebhook, verifyDestination: verification
    });
    expect(changedMail.outcome).toBe('SKIPPED');
    expect(changedHook.outcome).toBe('SKIPPED');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendWebhook).not.toHaveBeenCalled();
  });

  it('delivers only when tenant, channel, destination hash and current consent all match', async () => {
    const send = vi.fn(async () => ({ accepted: true }));
    const ok = await deliverOutboxEntry(row('email', email), {
      getEmailConfig: async () => email, sendEmail: send, verifyDestination: verification
    });
    expect(ok).toMatchObject({ outcome: 'DELIVERED' });
    expect(send).toHaveBeenCalledOnce();
    const differentTenant = await deliverOutboxEntry({ ...row('email', email), tenant_id: tenant + '-other' }, {
      getEmailConfig: async () => email, sendEmail: send, verifyDestination: verification
    });
    expect(differentTenant.outcome).toBe('SKIPPED');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports delivery only on an actual lease-token ack, not after losing DB ownership', async () => {
    const entries = [row('email', email), { ...row('webhook', webhook), id: 7 }];
    const counts = await runNotificationOutboxBatch({
      claim: async () => entries,
      renewLease: async () => true,
      complete: async () => false,
      retry: async () => false,
      getEmailConfig: async () => email,
      getWebhookConfig: async () => webhook,
      sendEmail: async () => ({ accepted: true }),
      sendWebhook: async () => ({ dispatched: false, reason: 'UPSTREAM_503' }),
      verifyDestination: verification
    });
    expect(counts).toEqual({ processed: 2, delivered: 0, skipped: 0, retried: 0, lostLease: 2 });
  });

  it('claims with lease longer than maximum 20-job batch and fences stale updates', async () => {
    process.env.NODE_ENV = 'production';
    const statements = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      statements.push({ sql, params });
      if (sql.startsWith('SELECT * FROM notification_outbox')) return [[], []];
      return [{ affectedRows: 1 }, []];
    }});
    await db.claimNotificationOutbox(20);
    const claim = statements.find(q => q.sql.includes('lease_expires_at = DATE_ADD'));
    expect(claim.sql).toContain('INTERVAL 300 SECOND');
    expect(claim.sql).toContain("status = 'PENDING'");
    expect(claim.sql).toContain("status = 'PROCESSING'");
    expect(claim.params[1]).toBe(20);
    const ack = await db.finishNotificationOutbox(42, 'lease-1', 'DELIVERED');
    expect(ack).toBe(true);
    const finish = statements.at(-1);
    expect(finish.sql).toContain("WHERE id = ? AND lease_token = ? AND status = 'PROCESSING'");
    expect(finish.params).toEqual(['DELIVERED', 42, 'lease-1']);
  });

  it('refuses a transactional alert enqueue without destination hash', async () => {
    const actions = [];
    process.env.NODE_ENV = 'production';
    db.setConnectionStateForTesting(true, {
      getConnection: async () => ({
        beginTransaction: async () => actions.push('begin'),
        query: async () => { actions.push('query'); return [{ insertId: 10 }, []]; },
        rollback: async () => actions.push('rollback'),
        commit: async () => actions.push('commit'),
        release: () => actions.push('release')
      })
    });
    await expect(db.createAlert({ tenant_id: tenant, device_id: 'PC-1' },
      [{ channel: 'email', event }])).rejects.toThrow('INVALID_NOTIFICATION_CHANNEL');
    expect(actions).toEqual([]);
  });
});
