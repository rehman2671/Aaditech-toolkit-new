// An unset/development/staging NODE_ENV is still a deployed server, not a
// trusted synthetic fixture. Only explicit Node test mode may skip database
// account + workspace membership revalidation.
export function requiresPersistedUserAuthorization(nodeEnv) {
  return nodeEnv !== 'test';
}

// A JWT is a signed workspace selection request, not an authorization
// record. Production privileges must be derived from the current database
// user AND an approved, active membership for a secondary workspace.
export function resolveVerifiedUserPrincipal(claims, stored, normalizeRole,
  production = true, membership = null) {
  if (!claims || typeof claims !== 'object' || typeof normalizeRole !== 'function') return null;

  const hasStoredIdentity = Boolean(stored &&
    String(stored.id ?? '') === String(claims.id ?? '') &&
    stored.username && String(stored.username) === String(claims.username ?? '') &&
    stored.tenant_id && stored.role &&
    stored.active === true &&
    String(stored.status || 'ACTIVE').toUpperCase() === 'ACTIVE');

  if (stored && stored.active === false) return null;
  if (!production) {
    // Existing offline fixtures use synthetic user roles; never interpret
    // those fixtures as evidence of authorization in a deployed server.
    return {
      id: claims.id, username: claims.username, email: claims.email,
      role: normalizeRole(claims.role),
      tenant_id: claims.tenant_id || '00000000-0000-0000-0000-000000000001',
      jti: claims.jti
    };
  }
  if (!hasStoredIdentity) return null;

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

  return null;
}
