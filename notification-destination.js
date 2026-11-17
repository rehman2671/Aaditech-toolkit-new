// Stage N21: a pending notification must never be exported to a recipient
// or webhook URL changed *after* the originating alert was created.
// Only a keyed fingerprint is persisted in MySQL; never persist credentials,
// destination URLs or email addresses in outbox headers.
import crypto from 'node:crypto';
import { isApprovedWebhookUrl } from './tenant-alert-safety.js';
import { smtpTransportConfig, isApprovedEmailRecipient } from './smtp-alerts.js';

export function destinationFingerprint(tenantId, channel, config, env = process.env) {
  if (typeof tenantId !== 'string' || !tenantId.trim() ||
      !['email', 'webhook'].includes(channel) || !config?.enabled) return null;
  const secret = String(env.HMAC_SECRET || '');
  if (secret.length < 16) return null;
  let destination = null;
  if (channel === 'webhook') {
    if (!isApprovedWebhookUrl(config.url, env.WEBHOOK_ALLOWED_HOSTS || '')) return null;
    // Preserve the entire URL including query/path token in the digest, but
    // never store it in any alert/outbox record or log output.
    destination = new URL(config.url).href;
  } else {
    const transport = smtpTransportConfig(env);
    if (!transport || !isApprovedEmailRecipient(config.recipient, transport)) return null;
    destination = String(config.recipient).toLowerCase();
  }
  return crypto.createHmac('sha256', secret)
    .update(JSON.stringify([tenantId, channel, destination]), 'utf8')
    .digest('hex');
}

export function matchesQueuedDestination(row, config, env = process.env) {
  if (!row || !/^[0-9a-f]{64}$/.test(String(row.destination_hash || ''))) return false;
  const current = destinationFingerprint(row.tenant_id, row.channel, config, env);
  if (!current) return false;
  const a = Buffer.from(row.destination_hash, 'hex');
  const b = Buffer.from(current, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
