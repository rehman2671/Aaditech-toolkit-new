import { describe, it, expect } from 'vitest';
import { resolveVerifiedUserPrincipal, requiresPersistedUserAuthorization } from '../../auth-principal.js';

const norm = r => String(r || '').toUpperCase();
const base = {
  id: 81, username: 'tenant-admin', email: 'tenant@example.org',
  tenant_id: '00000000-0000-0000-0000-000000000081',
  role: 'SUPER_ADMIN', active: true, status: 'ACTIVE'
};
const claims = { id: 81, username: 'tenant-admin', email: 'tenant@example.org',
  tenant_id: base.tenant_id, role: 'SUPER_ADMIN', jti: 'j-81' };

describe('Default-deny auth mode selection', () => {
  it('requires current database authorization when NODE_ENV is missing or not explicit test', () => {
    for (const nodeEnv of [undefined, '', 'development', 'staging', 'Production', 'production']) {
      expect(requiresPersistedUserAuthorization(nodeEnv)).toBe(true);
      expect(resolveVerifiedUserPrincipal(claims, null, norm,
        requiresPersistedUserAuthorization(nodeEnv))).toBeNull();
    }
    // Forgetting the mode argument must default to DB-bound security, not
    // permissive synthetic JWT fixture acceptance.
    expect(resolveVerifiedUserPrincipal(claims, null, norm)).toBeNull();
    expect(requiresPersistedUserAuthorization('test')).toBe(false);
    expect(resolveVerifiedUserPrincipal(claims, null, norm, false)?.tenant_id).toBe(claims.tenant_id);
  });
});

describe('Stage 12 current-user production JWT binding', () => {
  it('accepts exactly the active current tenant identity', () => {
    expect(resolveVerifiedUserPrincipal(claims, base, norm, true)).toEqual({
      id: 81, username: 'tenant-admin', email: 'tenant@example.org',
      role: 'SUPER_ADMIN', tenant_id: base.tenant_id, jti: 'j-81'
    });
  });
  it('denies deleted/disabled or suspended identities without JWT fallback', () => {
    expect(resolveVerifiedUserPrincipal(claims, null, norm, true)).toBeNull();
    expect(resolveVerifiedUserPrincipal(claims, { ...base, active: false }, norm, true)).toBeNull();
    expect(resolveVerifiedUserPrincipal(claims, { ...base, status: 'SUSPENDED' }, norm, true)).toBeNull();
  });
  it('denies stale role, tenant, username and identifier claims', () => {
    for (const record of [
      { ...base, role: 'OPERATOR' },
      { ...base, tenant_id: '00000000-0000-0000-0000-000000000082' },
      { ...base, username: 'renamed-admin' },
      { ...base, id: 82 },
      { ...base, tenant_id: null },
      { ...base, role: null }
    ]) {
      expect(resolveVerifiedUserPrincipal(claims, record, norm, true)).toBeNull();
    }
  });
  it('preserves isolated unit-test JWT fixtures while blocking known disabled accounts', () => {
    expect(resolveVerifiedUserPrincipal(claims, null, norm, false)?.tenant_id).toBe(base.tenant_id);
    expect(resolveVerifiedUserPrincipal(claims, { ...base, active: false }, norm, false)).toBeNull();
  });
});
