import {describe,it,expect} from 'vitest';
import crypto from 'node:crypto';
import {sha256} from '../../Enterprise/deploy/stage33-receipt-core.mjs';
import {publicKeyPin,buildPayload,signAttestation,verifyAttestation} from '../../Enterprise/deploy/stage34-attestation-core.mjs';

function fixture() {
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
  const time=new Date().toISOString();
  const offline={
    schema:'aaditech-stage32-offline-v1',phase:'OFFLINE_OPERATOR_ATTESTED',
    run_id:'a'.repeat(32),batch_id:'b'.repeat(32),captured_utc:'2026-11-18T03:20:21.0000000Z',
    in_flight_events:1,payload_sha256:'c'.repeat(64),
    queue_identity_sha256:'d'.repeat(64),event_ids_sha256:'e'.repeat(64),
    network_interruption_independently_measured:false,
    server_receipt_independently_verified:false,certified_for_production:false
  };
  const offlineBytes=Buffer.from(JSON.stringify(offline));
  const recovered={
    schema:'aaditech-stage32-recovered-v1',phase:'LOCAL_SQLITE_ACK_OBSERVED',
    run_id:offline.run_id,batch_id:offline.batch_id,
    captured_utc:'2026-11-18T03:21:21.0000000Z',
    local_ack_observed:true,delivered_event_count:1,
    offline_evidence_sha256:sha256(offlineBytes),
    queue_identity_sha256:offline.queue_identity_sha256,
    payload_sha256:offline.payload_sha256,
    network_interruption_independently_measured:false,
    server_receipt_independently_verified:false,certified_for_production:false
  };
  const recoveredBytes=Buffer.from(JSON.stringify(recovered));
  const receipt={
    schema:'aaditech-stage33-server-receipt-v1',run_id:offline.run_id,batch_id:offline.batch_id,
    scoped_owner_fingerprint_sha256:'f'.repeat(64),offline_evidence_sha256:sha256(offlineBytes),
    recovered_evidence_sha256:sha256(recoveredBytes),local_payload_sha256:offline.payload_sha256,
    receipt_count:1,accepted_count:1,
    recorded_at_database_utc:'2026-11-18T03:21:21.000000Z',
    server_request_hash_fingerprint_sha256:'1'.repeat(64),
    scoped_mysql_receipt_verified:true,report_authenticated_to_operator:false,
    raw_http_json_hash_matched:false,network_partition_independently_measured:false,
    production_certified:false
  };
  const receiptBytes=Buffer.from(JSON.stringify(receipt));
  return {time,privateKey,publicKey,offline,recovered,receipt,offlineBytes,recoveredBytes,receiptBytes};
}
describe('N34 offline independently pinned Ed25519 operator evidence',()=>{
  it('signs exact N32/N33 file digests with no production claim',()=>{
    const f=fixture(); const pin=publicKeyPin(f.publicKey);
    const signed=signAttestation(f,f.privateKey,f.time);
    const verified=verifyAttestation(f,signed,f.publicKey,pin,new Date(f.time));
    expect(signed.algorithm).toBe('Ed25519');
    expect(signed.public_key_spki_sha256).toBe(pin);
    expect(signed.payload.customer_production_certified).toBe(false);
    expect(signed.payload.physical_network_loss_certified).toBe(false);
    expect(verified.signature_verified).toBe(true);
    expect(verified.production_certified).toBe(false);
    expect(verified.source_authority_approval_independently_required).toBe(true);
    expect(JSON.stringify(signed)).not.toContain('PRIVATE KEY');
  });
  it('rejects tampered local/remote evidence and forged claims',()=>{
    const f=fixture(),pin=publicKeyPin(f.publicKey);
    const signed=signAttestation(f,f.privateKey,f.time);
    expect(()=>verifyAttestation({...f,receiptBytes:Buffer.concat([f.receiptBytes,Buffer.from('x')])},
      signed,f.publicKey,pin,new Date(f.time))).toThrow('ATTESTATION_EVIDENCE_MISMATCH');
    expect(()=>verifyAttestation({...f,recovered:{...f.recovered,delivered_event_count:3}},
      signed,f.publicKey,pin,new Date(f.time))).toThrow('EVENT_COUNT_MISMATCH');
    expect(()=>verifyAttestation({...f,receipt:{...f.receipt,production_certified:true}},
      signed,f.publicKey,pin,new Date(f.time))).toThrow('INVALID_REPORT_STATES');
    expect(()=>verifyAttestation(f,{...signed,payload:{...signed.payload,customer_production_certified:true}},
      f.publicKey,pin,new Date(f.time))).toThrow('ATTESTATION_EVIDENCE_MISMATCH');
  });
  it('requires independent pinned key, rejects invalid signature and key substitution',()=>{
    const f=fixture(),pin=publicKeyPin(f.publicKey),signed=signAttestation(f,f.privateKey,f.time);
    const other=crypto.generateKeyPairSync('ed25519');
    expect(()=>verifyAttestation(f,signed,other.publicKey,pin,new Date(f.time)))
      .toThrow('PUBLIC_KEY_NOT_APPROVED');
    expect(()=>verifyAttestation(f,signed,f.publicKey,publicKeyPin(other.publicKey),new Date(f.time)))
      .toThrow('INVALID_ATTESTATION');
    const corrupted={...signed,signature_base64:Buffer.alloc(64,3).toString('base64')};
    expect(()=>verifyAttestation(f,corrupted,f.publicKey,pin,new Date(f.time)))
      .toThrow('ATTESTATION_SIGNATURE_INVALID');
    const fake={...signed,external_approval:true};
    expect(()=>verifyAttestation(f,fake,f.publicKey,pin,new Date(f.time)))
      .toThrow('ATTESTATION_UNEXPECTED_FIELDS');
  });
  it('checks clock validity including 7 fractional PowerShell digits, expiry, RSA refusal',()=>{
    const f=fixture(),pin=publicKeyPin(f.publicKey),signed=signAttestation(f,f.privateKey,f.time);
    expect(()=>verifyAttestation(f,signed,f.publicKey,pin,
      new Date(Date.parse(f.time)+91*24*60*60*1000))).toThrow('ATTESTATION_EXPIRED_OR_FUTURE');
    const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
    expect(()=>signAttestation(f,rsa.privateKey,f.time)).toThrow('ED25519_KEY_REQUIRED');
    const incorrect={...f,offline:{...f.offline,captured_utc:'invalid'}};
    expect(()=>buildPayload({...incorrect,issuedAt:f.time})).toThrow('INVALID_REPORT_CLOCK');
  });
});
