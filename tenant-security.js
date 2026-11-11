// Phase K: strict tenant isolation. SUPER_ADMIN is a tenant role, not a
// platform-wide bypass. Any cross-tenant support action needs a separate,
// audited platform-operator identity and explicit delegation in a future phase.
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export function ownsTenant(actor, resource) {
  if (!actor || typeof actor.tenant_id !== 'string' || !actor.tenant_id.trim()) return false;
  const tenant = typeof resource === 'string' ? resource : resource?.tenant_id;
  return typeof tenant === 'string' && !!tenant.trim() && tenant === actor.tenant_id;
}

export function filterTenantRecords(actor, records) {
  return Array.isArray(records) ? records.filter(record => ownsTenant(actor, record)) : [];
}

const DEVICE_PRIVATE_FIELDS = new Set([
  'device_token_hash', 'auth_token_hash', 'device_token_prefix',
  'agent_token', 'device_token', 'bootstrap_token', 'token',
  'command_signing_key', 'hmac_secret', 'private_key', 'password'
]);

export function publicDeviceRecord(record) {
  if (!record) return null;
  return Object.fromEntries(Object.entries(record).filter(([name]) => !DEVICE_PRIVATE_FIELDS.has(name)));
}

export function isBoundUserSession(decoded, storedUser) {
  if (!decoded || !storedUser || storedUser.active === false ||
      String(storedUser.status || 'ACTIVE').toUpperCase() === 'DISABLED') return false;
  if (!decoded.id || String(decoded.id) !== String(storedUser.id)) return false;
  if (!ownsTenant(decoded, storedUser)) return false;
  if (String(decoded.username || '') !== String(storedUser.username || '')) return false;
  return true;
}

export function deviceOwnsCommand(device, command) {
  return Boolean(device && command &&
    String(device.id) === String(command.device_id || command.agent_id) &&
    ownsTenant(device, command.tenant_id || device.tenant_id));
}
