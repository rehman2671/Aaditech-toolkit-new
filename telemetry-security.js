import crypto from 'node:crypto';

// Cache namespaces are scoped to the exact enrolled credential generation.
// No raw token or stored token hash appears in the Redis key.
export function appUsageCredentialCacheKey({tenantId,deviceId,tokenHash,revoked} = {}) {
  if (typeof tenantId !== 'string' || !tenantId ||
      typeof deviceId !== 'string' || !deviceId ||
      typeof tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(tokenHash) ||
      ![false,0,'0'].includes(revoked)) return null;
  return 'app_usage:v2:' + crypto.createHash('sha256')
    .update(JSON.stringify([tenantId,deviceId,tokenHash])).digest('hex');
}
