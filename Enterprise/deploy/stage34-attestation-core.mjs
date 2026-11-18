// Phase N34: cryptographically bind the independent N33 server observation to
// the exact N32 local evidence files. Pure functions; no network or DB I/O.
import crypto from 'node:crypto';
import {sha256} from './stage33-receipt-core.mjs';

export class Stage34Error extends Error {
  constructor(code) { super(code); this.code=code; }
}
const deny=code=>{throw new Stage34Error(code);};
const hash=s=>typeof s==='string' && /^[0-9a-f]{64}$/.test(s);
const id32=s=>typeof s==='string' && /^[0-9a-f]{32}$/.test(s);
const validObject=o=>o && typeof o==='object' && !Array.isArray(o);

export function publicKeyPin(publicKey) {
  const key=crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType!=='ed25519') deny('ED25519_KEY_REQUIRED');
  return sha256(key.export({type:'spki',format:'der'}));
}
function validateDate(value) {
  return typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
}
// PowerShell DateTime.ToString('o') emits seven fractional digits while
// JavaScript ISO timestamps emit three. Preserve both exact UTC encodings.
function validSourceClock(value) {
  if (typeof value!=='string' ||
      !/^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3,7}Z$/.test(value)) return false;
  const time=Date.parse(value);
  return Number.isFinite(time);
}
function checkReports(receipt,offline,recovered,offlineBytes,recoveredBytes) {
  if (![receipt,offline,recovered].every(validObject) ||
      !Buffer.isBuffer(offlineBytes) || !Buffer.isBuffer(recoveredBytes)) deny('INVALID_INPUT');
  if (receipt.schema!=='aaditech-stage33-server-receipt-v1' ||
      offline.schema!=='aaditech-stage32-offline-v1' ||
      recovered.schema!=='aaditech-stage32-recovered-v1' ||
      offline.phase!=='OFFLINE_OPERATOR_ATTESTED' ||
      recovered.phase!=='LOCAL_SQLITE_ACK_OBSERVED' ||
      receipt.scoped_mysql_receipt_verified!==true ||
      receipt.receipt_count!==1 || receipt.report_authenticated_to_operator!==false ||
      receipt.production_certified!==false || receipt.raw_http_json_hash_matched!==false ||
      receipt.network_partition_independently_measured!==false ||
      offline.server_receipt_independently_verified!==false ||
      recovered.server_receipt_independently_verified!==false ||
      offline.certified_for_production!==false || recovered.certified_for_production!==false ||
      offline.network_interruption_independently_measured!==false ||
      recovered.network_interruption_independently_measured!==false ||
      recovered.local_ack_observed!==true) deny('INVALID_REPORT_STATES');
  if (!id32(offline.run_id) || !id32(offline.batch_id) ||
      receipt.run_id!==offline.run_id || recovered.run_id!==offline.run_id ||
      receipt.batch_id!==offline.batch_id || recovered.batch_id!==offline.batch_id ||
      !hash(offline.payload_sha256) ||
      !hash(offline.queue_identity_sha256) || !hash(offline.event_ids_sha256) ||
      !hash(receipt.scoped_owner_fingerprint_sha256) ||
      !hash(receipt.server_request_hash_fingerprint_sha256) ||
      receipt.offline_evidence_sha256!==sha256(offlineBytes) ||
      recovered.offline_evidence_sha256!==sha256(offlineBytes) ||
      receipt.recovered_evidence_sha256!==sha256(recoveredBytes) ||
      receipt.local_payload_sha256!==offline.payload_sha256 ||
      recovered.payload_sha256!==offline.payload_sha256 ||
      recovered.queue_identity_sha256!==offline.queue_identity_sha256) deny('REPORT_HASH_MISMATCH');
  if (!Number.isSafeInteger(offline.in_flight_events) || offline.in_flight_events<0 ||
      offline.in_flight_events>50 || recovered.delivered_event_count!==offline.in_flight_events ||
      receipt.accepted_count!==offline.in_flight_events) deny('EVENT_COUNT_MISMATCH');
  if (!validSourceClock(offline.captured_utc) || !validSourceClock(recovered.captured_utc) ||
      Date.parse(recovered.captured_utc)<Date.parse(offline.captured_utc) ||
      typeof receipt.recorded_at_database_utc!=='string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(receipt.recorded_at_database_utc)) {
    deny('INVALID_REPORT_CLOCK');
  }
}
// Canonical signed payload derived from the evidence; not user-configurable.
// Never sign "production_certified":true or external acceptance claims.
export function buildPayload({receipt,offline,recovered,receiptBytes,offlineBytes,recoveredBytes,issuedAt}) {
  if (!Buffer.isBuffer(receiptBytes)) deny('INVALID_INPUT');
  checkReports(receipt,offline,recovered,offlineBytes,recoveredBytes);
  if (!validateDate(issuedAt)) deny('INVALID_SIGNATURE_TIME');
  return {
    schema:'aaditech-stage34-pinned-operator-payload-v1',
    purpose:'INDEPENDENT_OPERATOR_REVIEW_OF_SCOPED_MYSQL_RECEIPT',
    issued_at_utc:issuedAt,
    run_id:receipt.run_id,
    batch_id:receipt.batch_id,
    accepted_count:receipt.accepted_count,
    scoped_owner_fingerprint_sha256:receipt.scoped_owner_fingerprint_sha256,
    offline_evidence_sha256:sha256(offlineBytes),
    recovered_evidence_sha256:sha256(recoveredBytes),
    server_receipt_sha256:sha256(receiptBytes),
    public_signoff_scope:'RECEIPT_REPORT_INTEGRITY_ONLY',
    physical_network_loss_certified:false,
    actual_mysql_operator_authorized_externally:false,
    customer_production_certified:false
  };
}
export function signAttestation(input,privateKey,issuedAt=new Date().toISOString()) {
  const key=crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType!=='ed25519') deny('ED25519_KEY_REQUIRED');
  const payload=buildPayload({...input,issuedAt});
  const publicKey=crypto.createPublicKey(key);
  const pin=publicKeyPin(publicKey);
  const signature=crypto.sign(null,Buffer.from(JSON.stringify(payload),'utf8'),key);
  return {
    schema:'aaditech-stage34-operator-attestation-v1',
    algorithm:'Ed25519',
    public_key_spki_sha256:pin,
    payload,
    signature_base64:signature.toString('base64')
  };
}
export function verifyAttestation(input,attestation,trustedPublicKey,approvedPin,now=new Date()) {
  if (!validObject(attestation) || !validObject(attestation.payload) ||
      attestation.schema!=='aaditech-stage34-operator-attestation-v1' ||
      attestation.algorithm!=='Ed25519' ||
      !hash(attestation.public_key_spki_sha256) || !hash(approvedPin) ||
      attestation.public_key_spki_sha256!==approvedPin ||
      typeof attestation.signature_base64!=='string' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(attestation.signature_base64)) deny('INVALID_ATTESTATION');
  const key=crypto.createPublicKey(trustedPublicKey);
  if (publicKeyPin(key)!==approvedPin) deny('PUBLIC_KEY_NOT_APPROVED');
  const issued=attestation.payload.issued_at_utc;
  if (!validateDate(issued) || !(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      Date.parse(issued)>now.getTime()+5*60*1000 ||
      Date.parse(issued)<now.getTime()-90*24*60*60*1000) deny('ATTESTATION_EXPIRED_OR_FUTURE');
  const expected=buildPayload({...input,issuedAt:issued});
  if (JSON.stringify(attestation.payload)!==JSON.stringify(expected)) deny('ATTESTATION_EVIDENCE_MISMATCH');
  const sig=Buffer.from(attestation.signature_base64,'base64');
  if (sig.length!==64 || sig.toString('base64')!==attestation.signature_base64 ||
      !crypto.verify(null,Buffer.from(JSON.stringify(expected),'utf8'),key,sig)) {
    deny('ATTESTATION_SIGNATURE_INVALID');
  }
  if (Object.keys(attestation).sort().join(',')!==
      ['algorithm','payload','public_key_spki_sha256','schema','signature_base64'].sort().join(',')) {
    deny('ATTESTATION_UNEXPECTED_FIELDS');
  }
  return Object.freeze({
    schema:'aaditech-stage34-verification-result-v1',
    run_id:expected.run_id,
    batch_id:expected.batch_id,
    trusted_key_spki_sha256:approvedPin,
    attested_server_receipt_sha256:expected.server_receipt_sha256,
    signature_verified:true,
    source_authority_approval_independently_required:true,
    network_outage_independently_verified:false,
    production_certified:false
  });
}
