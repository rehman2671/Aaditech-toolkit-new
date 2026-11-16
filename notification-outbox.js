// Stage N17: stateless, crash-recoverable notification outbox consumer.
// Shared authoritative state is the database; no in-process delivery queue.
import * as db from './db.js';
import { deliverTenantWebhook } from './tenant-alert-safety.js';
import { deliverTenantEmail } from './smtp-alerts.js';

export async function deliverOutboxEntry(row, adapters = {}) {
  if (!row?.tenant_id || !['webhook', 'email'].includes(row.channel)) {
    return { outcome: 'SKIPPED', reason: 'INVALID_OUTBOX_TARGET' };
  }
  let event;
  try {
    event = typeof row.payload_json === 'string'
      ? JSON.parse(row.payload_json) : row.payload_json;
  } catch {
    return { outcome: 'SKIPPED', reason: 'INVALID_OUTBOX_PAYLOAD' };
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { outcome: 'SKIPPED', reason: 'INVALID_OUTBOX_PAYLOAD' };
  }

  if (row.channel === 'webhook') {
    const config = await (adapters.getWebhookConfig || db.getTenantWebhookConfig)(row.tenant_id);
    if (!config?.enabled) return { outcome: 'SKIPPED', reason: 'DISABLED' };
    const result = await (adapters.sendWebhook || deliverTenantWebhook)(
      row.tenant_id, config, event
    );
    if (result.dispatched) return { outcome: 'DELIVERED' };
    if (['WEBHOOK_URL_NOT_APPROVED', 'WEBHOOK_PAYLOAD_TOO_LARGE', 'DISABLED']
      .includes(result.reason)) return { outcome: 'SKIPPED', reason: result.reason };
    return { outcome: 'RETRY', reason: 'WEBHOOK_DELIVERY_FAILED' };
  }

  const config = await (adapters.getEmailConfig || db.getTenantEmailConfig)(row.tenant_id);
  if (!config?.enabled) return { outcome: 'SKIPPED', reason: 'DISABLED' };
  const result = await (adapters.sendEmail || deliverTenantEmail)(
    row.tenant_id, config, event
  );
  if (result.accepted) return { outcome: 'DELIVERED' };
  if (['RECIPIENT_NOT_APPROVED', 'DISABLED'].includes(result.reason)) {
    return { outcome: 'SKIPPED', reason: result.reason };
  }
  return { outcome: 'RETRY', reason: 'SMTP_DELIVERY_FAILED' };
}

export async function runNotificationOutboxBatch(adapters = {}) {
  const claim = adapters.claim || db.claimNotificationOutbox;
  const complete = adapters.complete || db.finishNotificationOutbox;
  const retry = adapters.retry || db.retryNotificationOutbox;
  const rows = await claim(20);
  if (!Array.isArray(rows) || !rows.length) return { processed: 0, delivered: 0, skipped: 0, retried: 0 };
  const counts = { processed: 0, delivered: 0, skipped: 0, retried: 0 };
  // Five concurrent messages => max ~25 seconds per 20-item batch under
  // per-recipient 5/12 sec timeouts; DB lease is 90 seconds.
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(rows.slice(i, i + 5).map(async row => {
      let outcome;
      try {
        outcome = await deliverOutboxEntry(row, adapters);
      } catch {
        outcome = { outcome: 'RETRY', reason: 'DELIVERY_EXCEPTION' };
      }
      if (outcome.outcome === 'DELIVERED') {
        await complete(row.id, row.lease_token, 'DELIVERED');
        counts.delivered += 1;
      } else if (outcome.outcome === 'SKIPPED') {
        await complete(row.id, row.lease_token, 'SKIPPED');
        counts.skipped += 1;
      } else {
        await retry(row, outcome.reason || 'DELIVERY_FAILED');
        counts.retried += 1;
      }
      counts.processed += 1;
    }));
  }
  return counts;
}

export function startNotificationOutboxWorker(intervalMs = 5000) {
  if (process.env.NODE_ENV !== 'production') return () => {};
  let running = false;
  let ticks = 0;
  const run = async () => {
    if (running || !db.isMysqlConnected()) return;
    running = true;
    try {
      await runNotificationOutboxBatch();
      if (++ticks % 720 === 0) await db.pruneNotificationOutbox();
    } catch (err) {
      // Codes only: never log event data, credentials or destination addresses.
      console.error('Notification outbox cycle failed:', err.code || 'DATABASE_UNAVAILABLE');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void run(); }, Math.max(1000, intervalMs));
  timer.unref?.();
  void run();
  return () => clearInterval(timer);
}
