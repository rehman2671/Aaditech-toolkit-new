// Devices are tenant-owned resources. A tenant SUPER_ADMIN is not a
// platform administrator, so a generic admin role grants no cross-tenant
// read, delete or inventory access.
export function belongsToCurrentTenant(principal, resource) {
  return Boolean(principal?.tenant_id && resource?.tenant_id &&
    String(principal.tenant_id) === String(resource.tenant_id));
}

const secretFields = new Set([
  'device_token', 'device_token_hash', 'device_token_prefix',
  'agent_token', 'agent_token_hash', 'agent_token_prefix',
  'auth_token', 'auth_token_hash', 'auth_token_prefix',
  'bootstrap_token', 'bootstrap_token_hash',
  'api_token', 'password_hash', 'command_signing_key',
  'hmac_secret', 'private_key'
]);

export function publicDeviceRecord(device) {
  const result = {};
  for (const [key, value] of Object.entries(device || {})) {
    if (!secretFields.has(key) && !/secret|credential|private_key/i.test(key)) {
      result[key] = value;
    }
  }
  return result;
}
