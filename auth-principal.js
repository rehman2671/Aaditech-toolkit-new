// A JWT is a signed workspace selection request, not an authorization
// record. Production privileges must be derived from the current database
// user AND an approved, active membership for a secondary workspace.
export function resolveVerifiedUserPrincipal(claims, stored, normalizeRole,
  production = false, membership = null) {
  if (!claims || typeof claims !== 'object' || typeof normalizeRole !== 'function') return null;

  const hasStoredIdentity = Boolean(stored &&
    String(stored.id ?? '') === String(claims.id ?? '') &&
    stored.username && String(stored.username) === String(claims.username ?? '') &&
    stored.tenant_id && stored.role &&
    stored.active === true &&
    String(stored.status || 'ACTIVE').toUpperCase() === 'ACTIVE');

  if (production && !hasStoredIdentity) return null;
  if (stored && stored.active === false) return null;

  if (hasStoredIdentity) {
    const isPrimary = String(stored.tenant_id) === String(claims.tenant_id);
    const activeMembership = !isPrimary && membership &&
      String(membership.user_id) === String(stored.id) &&
      String(membership.tenant_id) === String(claims.tenant_id) &&
      String(membership.status).toUpperCase() === 'ACTIVE' &&
      Boolean(membership.role);
    const effectiveRole = isPrimary ? normalizeRole(stored.role) :
      (activeMembership ? normalizeRole(membership.role) : null);
    if (!effectiveRole || effectiveRole !== normalizeRole(claims.role)) return null;
    return {
      id: stored.id, username: stored.username, email: stored.email,
      role: effectiveRole, tenant_id: claims.tenant_id, jti: claims.jti
    };
  }

  if (production) return null;
  // Existing nonproduction fixtures can use synthetic signed identities
  // without database seeding. Never do this in a real deployment.
  return {
    id: claims.id, username: claims.username, email: claims.email,
    role: normalizeRole(claims.role),
    tenant_id: claims.tenant_id || '00000000-0000-0000-0000-000000000001',
    jti: claims.jti
  };
}
