/**
 * Shared tenant/device collision preflight for first-time enrollment.
 * This module has no DB side effects: callers MUST run it before consuming
 * one-use bootstrap credentials or mutating any existing device row.
 *
 * The legacy global getDeviceByHostname()/getDeviceByUid() lookups are not
 * tenant-scoped. Until that storage layer is migrated, refuse collisions,
 * including same hostname in a second tenant, instead of hijacking tokens.
 */
export function validateEnrollmentIdentity({ tenantId, existingHost, existingUid, company, matchingDevices = null }) {
  if (!tenantId || typeof tenantId !== 'string') {
    return { ok: false, status: 403, code: 'INVALID_TENANT' };
  }
  if (!company || String(company.tenant_id) !== tenantId) {
    return { ok: false, status: 409, code: 'TENANT_COMPANY_MISSING' };
  }
  const records = matchingDevices === null
    ? [existingHost, existingUid].filter(Boolean)
    : matchingDevices.filter(Boolean);
  for (const record of records) {
    if (String(record.tenant_id) !== tenantId) {
      return { ok: false, status: 409, code: 'DEVICE_TENANT_CONFLICT' };
    }
  }
  // Multiple DB records claiming the same hostname or UID are ambiguous even
  // when all belong to one tenant. Do not arbitrarily rotate a cached match.
  const uniqueIds = new Set(records.map(record => String(record.id)));
  if (uniqueIds.size > 1 ||
      (existingUid && (!existingHost || String(existingUid.id) !== String(existingHost.id)))) {
    return { ok: false, status: 409, code: 'DEVICE_UID_CONFLICT' };
  }
  return { ok: true };
}
