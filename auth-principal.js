// Bind a signed user JWT to the current production database identity.
// A valid signature is necessary but not sufficient: role/tenant changes,
// account deletion and account disablement must invalidate old privileges.
export function resolveVerifiedUserPrincipal(claims, stored, normalizeRole, production = false) {
  if (!claims || typeof claims !== 'object' || typeof normalizeRole !== 'function') return null;
  if (production) {
    if (!stored ||
        String(stored.id ?? '') !== String(claims.id ?? '') ||
        !stored.username || String(stored.username) !== String(claims.username ?? '') ||
        !stored.tenant_id || String(stored.tenant_id) !== String(claims.tenant_id ?? '') ||
        !stored.role || normalizeRole(stored.role) !== normalizeRole(claims.role) ||
        stored.active !== true ||
        String(stored.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
      return null;
    }
    return {
      id: stored.id,
      username: stored.username,
      email: stored.email,
      role: normalizeRole(stored.role),
      tenant_id: stored.tenant_id,
      jti: claims.jti
    };
  }

  // Existing dev/CI synthetic JWT fixtures are allowed only outside
  // production; always reject a disabled account when one is found.
  if (stored && stored.active === false) return null;
  return {
    id: claims.id,
    username: claims.username,
    email: claims.email,
    role: normalizeRole(claims.role),
    tenant_id: claims.tenant_id || '00000000-0000-0000-0000-000000000001',
    jti: claims.jti
  };
}
