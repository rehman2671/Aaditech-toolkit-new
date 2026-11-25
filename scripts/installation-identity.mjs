// Stack-neutral identity contract. These decisions are *preflight only*;
// they do not authenticate backup provenance, observe databases, fence old
// servers or authorize destructive work. Runtime adapter/ADR still required.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATES = new Set(['absent', 'present', 'unknown']);
const FIELDS = ['database', 'credentials', 'service'];
export function validateInstallationIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== 2 || ['schema_version','installation_id'].some(k=>
        !Object.hasOwn(value,k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')) || value.schema_version !== 1 ||
      typeof value.installation_id !== 'string' || value.installation_id.length !== 36 ||
      !UUID_V4.test(value.installation_id)) throw new Error('INVALID_INSTALLATION_IDENTITY');
  return Object.freeze({ schema_version: 1, installation_id: value.installation_id });
}
const blocked = reason => Object.freeze({ decision:'BLOCKED', reason, mutation_authorized:false });
const plan = (reason, installation_id = null) => Object.freeze({
  decision:'PREFLIGHT_ONLY', reason, installation_id, mutation_authorized:false
});
export function planInstallationIdentity({ intent, observed, localIdentity = null,
  backupIdentity = null, previousInstanceFenced = false } = {}) {
  if (!observed || typeof observed !== 'object' || Array.isArray(observed) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(observed)) ||
      Reflect.ownKeys(observed).some(k=>!FIELDS.includes(k)) ||
      FIELDS.some(k => !Object.hasOwn(observed,k) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(observed,k),'value') ||
        !STATES.has(observed[k]) || observed[k] === 'unknown')) {
    return blocked('LOCAL_STATE_UNKNOWN');
  }
  let local, backup;
  try {
    local = localIdentity === null ? null : validateInstallationIdentity(localIdentity);
    backup = backupIdentity === null ? null : validateInstallationIdentity(backupIdentity);
  } catch {
    return blocked('INVALID_INSTALLATION_IDENTITY');
  }
  const empty = FIELDS.every(k => observed[k] === 'absent');
  if (!local && !empty) return blocked('EXISTING_STATE_WITHOUT_IDENTITY');
  if (intent === 'fresh') {
    if (!empty || local || backup) return blocked('FRESH_REQUIRES_EMPTY_TARGET');
    return plan('GENERATE_NEW_IDENTITY');
  }
  if (intent === 'reconfigure') {
    if (!local || backup || observed.database !== 'present' || observed.credentials !== 'present') {
      return blocked('RECONFIGURE_REQUIRES_IDENTITY_DATA_AND_CREDENTIALS');
    }
    return plan('PRESERVE_IDENTITY', local.installation_id);
  }
  if (intent === 'restore-same') {
    if (!backup) return blocked('BACKUP_IDENTITY_REQUIRED');
    if (local && local.installation_id !== backup.installation_id) {
      return blocked('CROSS_INSTALLATION_RESTORE_FORBIDDEN');
    }
    if (local && (observed.database !== 'present' || observed.credentials !== 'present')) {
      return blocked('EXISTING_RESTORE_CONTEXT_INCOMPLETE');
    }
    if (!local && previousInstanceFenced !== true) return blocked('PREVIOUS_INSTANCE_FENCE_REQUIRED');
    // The operator flag is only a planning input; actual fencing, backup
    // authenticity and restore authorization must be independently proven.
    return plan('PRESERVE_BACKUP_IDENTITY', backup.installation_id);
  }
  if (intent === 'clone-new') {
    // Never copy live credentials or tenant/device namespaces merely by
    // changing an ID. Clone execution remains unavailable pending ADR and
    // reviewed credential rekey/identity isolation/negative acceptance.
    return blocked('CLONE_REKEY_AND_ISOLATION_NOT_IMPLEMENTED');
  }
  return blocked('EXPLICIT_INTENT_REQUIRED');
}
