/**
 * Shared tenant/device collision preflight for first-time enrollment.
 * This module has no DB side effects: callers MUST run it before consuming
 * one-use bootstrap credentials or mutating any existing device row.
 *
 * The legacy global getDeviceByHostname()/getDeviceByUid() lookups are not
 * tenant-scoped. Until that storage layer is migrated, refuse collisions,
 * including same hostname in a second tenant, instead of hijacking tokens.
 */
export function validateEnrollmentIdentity({ tenantId, existingHost, existingUid, company }) {
  if (!tenantId || typeof tenantId !== 'string') {
    return { ok: false, status: 403, code: 'INVALID_TENANT' };
  }
  if (!company || String(company.tenant_id) !== tenantId) {
    return { ok: false, status: 409, code: 'TENANT_COMPANY_MISSING' };
  }
  for (const record of [existingHost, existingUid]) {
    if (record && String(record.tenant_id) !== tenantId) {
      return { ok: false, status: 409, code: 'DEVICE_TENANT_CONFLICT' };
    }
  }
  if (existingUid && (!existingHost || String(existingUid.id) !== String(existingHost.id))) {
    return { ok: false, status: 409, code: 'DEVICE_UID_CONFLICT' };
  }
  return { ok: true };
}
