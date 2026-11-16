import { describe, it, expect } from 'vitest';
import { isPlatformSettingsAdmin } from '../../platform-settings-admin.js';

const admin = { id: 7, tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', role: 'SUPER_ADMIN' };
describe('Global production settings operator authorization', () => {
  it('defaults to DENY in production without explicit operator identity and tenant', () => {
    expect(isPlatformSettingsAdmin(admin, { NODE_ENV: 'production' })).toBe(false);
    expect(isPlatformSettingsAdmin(admin, { NODE_ENV: 'production',
      PLATFORM_ADMIN_USER_ID: '7' })).toBe(false);
    expect(isPlatformSettingsAdmin({ ...admin, role: 'OPERATOR' },
      { NODE_ENV: 'test' })).toBe(false);
  });
  it('requires exact actor, operator workspace and super-admin role', () => {
    const env = { NODE_ENV: 'production', PLATFORM_ADMIN_USER_ID: '7',
      PLATFORM_OWNER_TENANT_ID: admin.tenant_id };
    expect(isPlatformSettingsAdmin(admin, env)).toBe(true);
    expect(isPlatformSettingsAdmin({ ...admin, id: 8 }, env)).toBe(false);
    expect(isPlatformSettingsAdmin({ ...admin,
      tenant_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }, env)).toBe(false);
    expect(isPlatformSettingsAdmin({ ...admin, role: 'MONITORING' }, env)).toBe(false);
  });
  it('retains disposable nonproduction workflow compatibility', () => {
    expect(isPlatformSettingsAdmin(admin, { NODE_ENV: 'test' })).toBe(true);
  });
});
