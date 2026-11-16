// Canonical external origin for downloadable agent setup artifacts.
// Production must NEVER trust caller-supplied Host or X-Forwarded-Proto.
const labelPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
function isPublicDns(host) {
  if (typeof host !== 'string' || host.length > 253 || host.length < 4) return false;
  const lower = host.toLowerCase();
  if (lower.endsWith('.local') || lower.endsWith('.localhost') ||
      lower.endsWith('.test') || lower.endsWith('.example') ||
      lower.endsWith('.invalid') || lower === 'localhost' ||
      /^[0-9.]+$/.test(host)) return false;
  const labels = host.split('.');
  return labels.length >= 2 && labels.every(label => labelPattern.test(label));
}

export function resolveAgentOrigin(request, branding = {}) {
  const production = process.env.NODE_ENV === 'production';
  if (production) {
    const host = String(process.env.SERVER_HOST || '').trim();
    if (!isPublicDns(host)) return null;
    return { host, protocol: 'https' };
  }

  const host = String(request?.headers?.host || branding?.server_host || '').trim();
  // Test/dev may use loopback with a port. Never interpolate shell quoting,
  // CR/LF, embedded schemes or attacker-controlled redirects into scripts.
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(?::[1-9][0-9]{0,4})?$/.test(host) ||
      host.includes('..') || host.length > 259) return null;
  const protocol = request?.protocol === 'https' ? 'https' : 'http';
  return { host, protocol };
}
