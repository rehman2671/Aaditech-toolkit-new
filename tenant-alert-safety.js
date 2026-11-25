import net from 'node:net';
import dns from 'node:dns/promises';
import https from 'node:https';

// Outbound webhook DNS is resolved once and the reviewed public IPv4 address
// is pinned to the TLS connection. Fetch-after-preflight would permit rebinding.
export function isPublicWebhookIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0 || a >= 224 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)) return false;
  return true;
}

export async function resolvePinnedWebhookIpv4(
  url, allowedHosts = process.env.WEBHOOK_ALLOWED_HOSTS || '',
  lookup = dns.lookup
) {
  if (!isApprovedWebhookUrl(url, allowedHosts)) {
    throw new Error('WEBHOOK_URL_NOT_APPROVED');
  }
  // IPv6-only destinations are intentionally unsupported until equivalent
  // globally-routable prefix validation is implemented and verified.
  const records = await lookup(new URL(url).hostname, { family: 4, all: true });
  if (!Array.isArray(records) || records.length === 0 ||
      records.some(record => record.family !== 4 || !isPublicWebhookIpv4(record.address))) {
    throw new Error('WEBHOOK_DNS_TARGET_NOT_PUBLIC');
  }
  return records[0].address;
}

// A fresh HTTPS request is opened with no shared agent and with lookup pinned
// to the reviewed address. Host header/SNI/certificate still use URL hostname.
export async function postPinnedWebhook(url, options, resolver = dns.lookup) {
  const address = await resolvePinnedWebhookIpv4(url, options.allowedHosts, resolver);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: options.headers,
      timeout: 5000,
      agent: false,
      family: 4,
      signal: options.signal,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      }
    }, response => {
      const status = Number(response.statusCode || 0);
      response.resume();
      response.on('end', () => resolve({
        ok: status >= 200 && status < 300, status
      }));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('WEBHOOK_TIMEOUT')));
    req.on('error', reject);
    req.end(options.body);
  });
}


export function scopedAlertRules(tenantId, rules) {
  if (typeof tenantId !== 'string' || tenantId.trim() === '' || !Array.isArray(rules)) return [];
  return rules.filter(rule => rule && (rule.enabled === true || rule.enabled === 1) &&
    rule.tenant_id === tenantId);
}

export function isApprovedWebhookUrl(rawUrl, allowedHosts = process.env.WEBHOOK_ALLOWED_HOSTS || '') {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048 || !rawUrl) return false;
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash ||
      (parsed.port && parsed.port !== '443')) return false;
  const hostname = parsed.hostname.toLowerCase();
  if (net.isIP(hostname) || hostname.endsWith('.') || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])\.[a-z]{2,63}$/.test(hostname)) return false;
  const allowed = String(allowedHosts).split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(hostname);
}

export async function deliverTenantWebhook(
  tenantId, config, event, fetcher = postPinnedWebhook,
  allowedHosts = process.env.WEBHOOK_ALLOWED_HOSTS || ''
) {
  if (typeof tenantId !== 'string' || !tenantId.trim() || config?.enabled !== true) return { dispatched: false, reason: 'DISABLED' };
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
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > 16384) {
    return { dispatched: false, reason: 'WEBHOOK_PAYLOAD_TOO_LARGE' };
  }
  const response = await fetcher(config.url, {
    method: 'POST',
    allowedHosts,
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(5000)
  });
  const status = Number.isInteger(response?.status) ? response.status : null;
  return { dispatched: response?.ok === true && status !== null && status >= 200 && status < 300, status_code: status };
}
