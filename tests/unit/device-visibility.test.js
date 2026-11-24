import { describe, it, expect } from 'vitest';
import { belongsToCurrentTenant, publicDeviceRecord } from '../../device-visibility.js';

describe('Phase N12 tenant-owned device visibility', () => {
  it('denies super-admin cross-tenant access with no global administrator bypass', () => {
    const principal = { role: 'SUPER_ADMIN', tenant_id: 't-1' };
    expect(belongsToCurrentTenant(principal, { tenant_id: 't-1' })).toBe(true);
    expect(belongsToCurrentTenant(principal, { tenant_id: 't-2' })).toBe(false);
    expect(belongsToCurrentTenant(principal, {})).toBe(false);
    expect(belongsToCurrentTenant({}, { tenant_id: 't-1' })).toBe(false);
  });
  it('never serializes agent bearer tokens, hashes or private material', () => {
    const device = { id: 'd-1', tenant_id: 't-1', hostname: 'WIN10',
      device_token: 'bearer', device_token_hash: 'sha256',
      device_token_prefix: 'prefix', agent_token_hash: 'private',
      auth_token_hash: 'legacy-hash', auth_token_prefix: 'legacy-prefix', auth_token: 'legacy-bearer',
      hmac_secret: 'hmac', password_hash: 'hash',
      client_private_key: 'private-pem', os_version: 'Windows' };
    const result = publicDeviceRecord(device);
    expect(result).toEqual({ id: 'd-1', tenant_id: 't-1',
      hostname: 'WIN10', os_version: 'Windows' });
    expect(JSON.stringify(result)).not.toContain('bearer');
  });
});
