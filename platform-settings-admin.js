// Global configuration changes affect every tenant, so a tenant SUPER_ADMIN
// role alone must not authorize them in production. Deployment operator
// explicitly selects one persistent account + its owner workspace via env.
export function isPlatformSettingsAdmin(principal, env = process.env) {
  if (!principal || String(principal.role || '').toUpperCase() !== 'SUPER_ADMIN') return false;
  if (env.NODE_ENV !== 'production') return true; // disposable CI/offline fixtures
  const id = String(env.PLATFORM_ADMIN_USER_ID || '').trim();
  const owner = String(env.PLATFORM_OWNER_TENANT_ID || '').trim();
  if (!/^[1-9][0-9]*$/.test(id) || !/^[a-f0-9-]{36}$/i.test(owner)) return false;
  return String(principal.id) === id && String(principal.tenant_id) === owner;
}
