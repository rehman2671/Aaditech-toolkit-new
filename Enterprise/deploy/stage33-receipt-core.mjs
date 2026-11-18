// Stage N33: pure, redacted evidence validation. Never logs secrets/IDs.
import crypto from 'node:crypto';
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export class Stage33Error extends Error {
  constructor(code) { super(code); this.code = code; }
}
const deny = code => { throw new Stage33Error(code); };
const hash = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const guid32 = s => typeof s === 'string' && /^[0-9a-fA-F]{32}$/.test(s);
const uuid = s => typeof s === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);
const obj = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateEvidence(offline, recovered, identity, offlineFileBytes, recoveredFileBytes) {
  if (!obj(offline) || !obj(recovered) || !obj(identity) ||
      !Buffer.isBuffer(offlineFileBytes) || !Buffer.isBuffer(recoveredFileBytes)) deny('INVALID_EVIDENCE');
  if (offline.schema !== 'aaditech-stage32-offline-v1' ||
      recovered.schema !== 'aaditech-stage32-recovered-v1' ||
      offline.phase !== 'OFFLINE_OPERATOR_ATTESTED' ||
      recovered.phase !== 'LOCAL_SQLITE_ACK_OBSERVED' ||
      offline.certified_for_production !== false ||
      recovered.certified_for_production !== false ||
      offline.server_receipt_independently_verified !== false ||
      recovered.server_receipt_independently_verified !== false ||
      recovered.local_ack_observed !== true ||
      offline.network_interruption_independently_measured !== false ||
      recovered.network_interruption_independently_measured !== false) deny('INVALID_EVIDENCE');
  if (!guid32(offline.run_id) || offline.run_id !== recovered.run_id ||
      offline.run_id !== identity.case_run_id ||
      !guid32(offline.batch_id) || offline.batch_id !== recovered.batch_id ||
      !hash(offline.payload_sha256) || offline.payload_sha256 !== recovered.payload_sha256 ||
      !hash(offline.queue_identity_sha256) ||
      offline.queue_identity_sha256 !== recovered.queue_identity_sha256 ||
      !hash(offline.event_ids_sha256) ||
      recovered.offline_evidence_sha256 !== sha256(offlineFileBytes)) deny('EVIDENCE_MISMATCH');
  if (!Number.isSafeInteger(offline.in_flight_events) ||
      offline.in_flight_events < 0 || offline.in_flight_events > 50 ||
      recovered.delivered_event_count !== offline.in_flight_events) deny('EVENT_COUNT_MISMATCH');
  if (!uuid(identity.tenant_id) ||
      typeof identity.device_id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/.test(identity.device_id)) deny('INVALID_OWNER_SCOPE');
  if (offline.captured_utc && recovered.captured_utc &&
      (!Number.isFinite(Date.parse(offline.captured_utc)) ||
       !Number.isFinite(Date.parse(recovered.captured_utc)) ||
       Date.parse(recovered.captured_utc) < Date.parse(offline.captured_utc))) deny('EVIDENCE_CLOCK_INVALID');
  return Object.freeze({
    runId: offline.run_id, batchId: offline.batch_id,
    tenantId: identity.tenant_id, deviceId: identity.device_id,
    expectedCount: offline.in_flight_events,
    offlineSha256: sha256(offlineFileBytes),
    recoveredSha256: sha256(recoveredFileBytes),
    payloadSha256: offline.payload_sha256,
    scopeFingerprint: sha256([identity.tenant_id, identity.device_id, offline.batch_id].join('\u0000'))
  });
}

// Caller supplies a DB connection inside START TRANSACTION READ ONLY.
// The sole evidence query is an indexed, parameterized, owner-scoped SELECT.
export async function verifyScopedReceipt(queryRows, context) {
  if (typeof queryRows !== 'function' || !context || !uuid(context.tenantId) ||
      typeof context.deviceId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/.test(context.deviceId) ||
      !guid32(context.batchId) || !Number.isSafeInteger(context.expectedCount)) deny('INVALID_OWNER_SCOPE');
  const sql = "SELECT request_hash, accepted_count, " +
    "DATE_FORMAT(recorded_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS recorded_at_utc " +
    'FROM telemetry_batches WHERE tenant_id=? AND device_id=? AND batch_id=? LIMIT 2';
  const rows = await queryRows(sql, [context.tenantId, context.deviceId, context.batchId]);
  if (!Array.isArray(rows) || rows.length !== 1) deny('RECEIPT_NOT_UNIQUE_OR_NOT_FOUND');
  const receipt = rows[0];
  if (!hash(receipt.request_hash) ||
      !Number.isSafeInteger(Number(receipt.accepted_count)) ||
      Number(receipt.accepted_count) !== context.expectedCount ||
      typeof receipt.recorded_at_utc !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(receipt.recorded_at_utc)) {
    deny('RECEIPT_MISMATCH');
  }
  return Object.freeze({
    schema: 'aaditech-stage33-server-receipt-v1',
    run_id: context.runId,
    batch_id: context.batchId,
    scoped_owner_fingerprint_sha256: context.scopeFingerprint,
    offline_evidence_sha256: context.offlineSha256,
    recovered_evidence_sha256: context.recoveredSha256,
    local_payload_sha256: context.payloadSha256,
    receipt_count: 1,
    accepted_count: Number(receipt.accepted_count),
    recorded_at_database_utc: receipt.recorded_at_utc,
    server_request_hash_fingerprint_sha256: sha256(receipt.request_hash),
    scoped_mysql_receipt_verified: true,
    raw_http_json_hash_matched: false,
    network_partition_independently_measured: false,
    report_authenticated_to_operator: false,
    production_certified: false,
    external_release_gates: 'PENDING_INDEPENDENT_APPROVAL'
  });
}
