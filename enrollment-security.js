/**
 * Shared tenant/device collision preflight for first-time enrollment.
 * This module has no DB side effects: callers MUST run it before consuming
 * one-use bootstrap credentials or mutating any existing device row.
 *
 * The legacy global getDeviceByHostname()/getDeviceByUid() lookups are not
 * tenant-scoped. Until that storage layer is migrated, refuse collisions,
 * including same hostname in a second tenant, instead of hijacking tokens.
 */
export function validateEnrollmentIdentity({ tenantId, existingHost, existingUid, company, matchingDevices = null, requestedUid = null }) {
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
  if (requestedUid && existingHost?.device_uid &&
      String(existingHost.device_uid).toLowerCase() !== String(requestedUid).toLowerCase()) {
    return { ok: false, status: 409, code: 'DEVICE_UID_CONFLICT' };
  }
  const uniqueIds = new Set(records.map(record => String(record.id)));
  if (uniqueIds.size > 1 ||
      (existingUid && (!existingHost || String(existingUid.id) !== String(existingHost.id)))) {
    return { ok: false, status: 409, code: 'DEVICE_UID_CONFLICT' };
  }
  return { ok: true };
}


// A bootstrap credential grants first enrollment, never replacement of an
// existing enrolled identity. Caller must hold the existing identity lock.
export function validateFreshEnrollment(matches) {
  if (!Array.isArray(matches)) return { ok: false, status: 503, code: 'DEVICE_IDENTITY_UNVERIFIED' };
  if (matches.length !== 0) return { ok: false, status: 409, code: 'DEVICE_ALREADY_REGISTERED' };
  return { ok: true };
}

// Match only an actual stored ID, UID or full hostname; no derived aliases.
export function matchesEnrolledDeviceIdentifier(device, target) {
  if (typeof target !== 'string' || !target.trim()) return false;
  const normalized = target.trim().toLowerCase();
  return [device?.id, device?.device_uid, device?.hostname].some(value =>
    typeof value === 'string' && value.length > 0 && value.toLowerCase() === normalized);
}


// Only current enrolled device credentials in canonical headers outside
// explicit test fixtures. Never consult URL, body or bootstrap headers.
export function extractEnrolledDeviceHeaderToken(headers = {}) {
  const canonical = headers['x-device-token'];
  const authorization = headers.authorization;
  const valid = value => typeof value === 'string' &&
    value.length === 56 && /^itk_dev_[a-f0-9]{48}$/.test(value);
  if (canonical !== undefined && !valid(canonical)) return null;
  let bearer;
  if (authorization !== undefined) {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
    bearer = authorization.slice(7);
    if (!valid(bearer)) return null;
  }
  if (canonical !== undefined && bearer !== undefined && canonical !== bearer) return null;
  return canonical ?? bearer ?? null;
}


// Strict UUID and database scalar boundaries shared by credential operations.
export const isCredentialDeviceId = value => typeof value === 'string' && value.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function credentialDbCount(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || value.length > 16 || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && String(n) === value ? n : null;
}
function exactRequestFields(body, fields) {
  return !!body && typeof body === 'object' && Object.getPrototypeOf(body) === Object.prototype &&
    Reflect.ownKeys(body).length === fields.length && fields.every(k => Object.hasOwn(body,k));
}

// Explicit administrative confirmation, fixed non-secret audit reason codes,
// and an immutable enrolled device ID, not a hostname alias.
export function validateDeviceRevocationRequest(deviceId, body) {
  const reasons = ['COMPROMISED', 'DEVICE_LOST', 'DECOMMISSIONED', 'ADMINISTRATIVE_HOLD'];
  if (!isCredentialDeviceId(deviceId) || !exactRequestFields(body,['confirm_device_id','reason_code']) ||
      body.confirm_device_id !== deviceId ||
      !reasons.includes(body.reason_code)) return null;
  return { deviceId, reasonCode: body.reason_code };
}


// Read-only recovery assessment: a snapshot is never authority to issue or
// activate a replacement credential. Return only categorical evidence.
export function classifyDeviceCredentialRecovery(row) {
  const outstanding = credentialDbCount(row?.outstanding_commands);
  const matches = credentialDbCount(row?.current_hash_matches);
  const revoked = [true, 1, '1'].includes(row?.agent_token_revoked) ? true :
    ([false, 0, '0'].includes(row?.agent_token_revoked) ? false : null);
  const current = row?.device_token_hash;
  const legacy = row?.auth_token_hash;
  const present = v => v !== null && v !== undefined && v !== '';
  let credentialState = 'MISSING';
  if (present(current)) {
    if (typeof current !== 'string' || current.length !== 64 || !/^[a-f0-9]{64}$/.test(current)) credentialState = 'INVALID_CURRENT';
    else if (matches === null || matches === 0) credentialState = 'UNVERIFIED';
    else if (matches !== 1) credentialState = 'AMBIGUOUS_CURRENT';
    else credentialState = 'CURRENT_UNIQUE';
  } else if (present(legacy)) credentialState = 'LEGACY_ONLY';
  const blockers = [];
  if (revoked === null || outstanding === null || credentialState === 'UNVERIFIED') blockers.push('STATE_UNVERIFIED');
  if (revoked === false) blockers.push('REVOKE_FIRST');
  if (outstanding !== null && outstanding > 0) blockers.push('COMMAND_RECONCILIATION_REQUIRED');
  if (credentialState !== 'CURRENT_UNIQUE') blockers.push('CREDENTIAL_MIGRATION_REVIEW_REQUIRED');
  // A server-side snapshot cannot certify endpoint ownership, local ACLs,
  // interruption safety, or already-running work on the device.
  blockers.push('AUTHORIZED_RECOVERY_HANDOFF_REQUIRED');
  return { credential_state: credentialState, credential_revoked: revoked,
    outstanding_commands: outstanding, blockers, replacement_allowed: false };
}


// Never treat a general recovery request as authorization to cancel commands.
export function validatePendingCommandReconciliation(deviceId, body) {
  if (!isCredentialDeviceId(deviceId) || !exactRequestFields(body,['confirm_device_id','action']) ||
      body.confirm_device_id !== deviceId ||
      body.action !== 'CANCEL_NEVER_CLAIMED_PENDING') return null;
  return {deviceId, action:body.action};
}
