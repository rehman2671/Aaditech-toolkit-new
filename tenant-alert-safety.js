import net from 'node:net';

export function scopedAlertRules(tenantId, rules) {
  if (typeof tenantId !== 'string' || tenantId.trim() === '' || !Array.isArray(rules)) return [];
  return rules.filter(rule => rule && Boolean(rule.enabled) &&
    String(rule.tenant_id || '') === tenantId);
}

export function isApprovedWebhookUrl(rawUrl, allowedHosts = process.env.WEBHOOK_ALLOWED_HOSTS || '') {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048 || !rawUrl) return false;
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return false;
  const hostname = parsed.hostname.toLowerCase();
  if (net.isIP(hostname) || hostname.endsWith('.') || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])\.[a-z]{2,63}$/.test(hostname)) return false;
  const allowed = String(allowedHosts).split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(hostname);
}

export async function deliverTenantWebhook(
  tenantId, config, event, fetcher = fetch,
  allowedHosts = process.env.WEBHOOK_ALLOWED_HOSTS || ''
) {
  if (!tenantId || !config?.enabled) return { dispatched: false, reason: 'DISABLED' };
  if (!isApprovedWebhookUrl(config.url, allowedHosts)) {
    return { dispatched: false, reason: 'WEBHOOK_URL_NOT_APPROVED' };
  }
  const format = config.type || 'generic';
  const title = String(event?.title || 'Alert');
  const message = String(event?.message || '');
  const severity = String(event?.severity || 'info');
  const details = event?.details || {};
  const payload = format === 'slack'
    ? { text: '[' + severity.toUpperCase() + '] ' + title + ': ' + message }
    : format === 'teams'
      ? { '@type': 'MessageCard', '@context': 'http://schema.org/extensions',
        summary: title, title, text: message }
      : { event: 'alert', title, message, severity, details };
  const response = await fetcher(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(5000)
  });
  return { dispatched: Boolean(response.ok), status_code: response.status };
}
