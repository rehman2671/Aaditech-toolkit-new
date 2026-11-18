import {describe,it,expect} from 'vitest';
import {sha256,validateEvidence,verifyScopedReceipt} from '../../Enterprise/deploy/stage33-receipt-core.mjs';

const tenant='e892aee3-1883-482f-a785-e49ed513d0d1';
const device='n33-001';
const run='a'.repeat(32),batch='b'.repeat(32),hash='c'.repeat(64);
function fixture(n=2) {
  const offline={
    schema:'aaditech-stage32-offline-v1',run_id:run,
    phase:'OFFLINE_OPERATOR_ATTESTED',batch_id:batch,payload_sha256:hash,
    queue_identity_sha256:'d'.repeat(64),event_ids_sha256:'e'.repeat(64),
    in_flight_events:n,network_interruption_independently_measured:false,
    server_receipt_independently_verified:false,certified_for_production:false
  };
  const offBytes=Buffer.from(JSON.stringify(offline));
  const recovered={
    schema:'aaditech-stage32-recovered-v1',run_id:run,
    phase:'LOCAL_SQLITE_ACK_OBSERVED',batch_id:batch,payload_sha256:hash,
    queue_identity_sha256:'d'.repeat(64),delivered_event_count:n,
    offline_evidence_sha256:sha256(offBytes),local_ack_observed:true,
    network_interruption_independently_measured:false,
    server_receipt_independently_verified:false,certified_for_production:false
  };
  const recBytes=Buffer.from(JSON.stringify(recovered));
  const id={case_run_id:run,tenant_id:tenant,device_id:device};
  return {offline,recovered,id,offBytes,recBytes};
}
describe('Stage N33 independent read-only receipt verification contract',()=>{
  it('validates owner-scoped stable N32 evidence and rejects tampered file hashes',()=>{
    const f=fixture();
    const ctx=validateEvidence(f.offline,f.recovered,f.id,f.offBytes,f.recBytes);
    expect(ctx.expectedCount).toBe(2);
    expect(ctx.offlineSha256).toBe(sha256(f.offBytes));
    expect(ctx.scopeFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.scopeFingerprint).not.toContain(tenant);
    expect(()=>validateEvidence(f.offline,{...f.recovered,offline_evidence_sha256:hash},
      f.id,f.offBytes,f.recBytes)).toThrow('EVIDENCE_MISMATCH');
    expect(()=>validateEvidence(f.offline,f.recovered,{...f.id,case_run_id:'f'.repeat(32)},
      f.offBytes,f.recBytes)).toThrow('EVIDENCE_MISMATCH');
    expect(()=>validateEvidence(f.offline,{...f.recovered,delivered_event_count:1},
      f.id,f.offBytes,f.recBytes)).toThrow('EVENT_COUNT_MISMATCH');
  });
  it('rejects forged local flags, invalid device scope and event overflow',()=>{
    const f=fixture();
    expect(()=>validateEvidence({...f.offline,certified_for_production:true},f.recovered,
      f.id,f.offBytes,f.recBytes)).toThrow('INVALID_EVIDENCE');
    expect(()=>validateEvidence(f.offline,f.recovered,{...f.id,device_id:"'; DROP TABLE devices;"},
      f.offBytes,f.recBytes)).toThrow('INVALID_OWNER_SCOPE');
    const large=fixture(51);
    expect(()=>validateEvidence(large.offline,large.recovered,large.id,large.offBytes,large.recBytes))
      .toThrow('EVENT_COUNT_MISMATCH');
  });
  it('uses only one parameterized owner-scoped SELECT and does not certify production',async()=>{
    const f=fixture(0);
    const ctx=validateEvidence(f.offline,f.recovered,f.id,f.offBytes,f.recBytes);
    const q=[];
    const report=await verifyScopedReceipt(async (sql,args)=>{
      q.push({sql,args});
      return [{request_hash:hash,accepted_count:0,recorded_at_utc:'2026-11-18T00:00:00.000000Z'}];
    },ctx);
    expect(q).toHaveLength(1);
    expect(q[0].sql).toMatch(/^SELECT /);
    expect(q[0].sql).toContain('tenant_id=? AND device_id=? AND batch_id=?');
    expect(q[0].args).toEqual([tenant,device,batch]);
    expect(report.scoped_mysql_receipt_verified).toBe(true);
    expect(report.accepted_count).toBe(0);
    expect(report.production_certified).toBe(false);
    expect(report.report_authenticated_to_operator).toBe(false);
    expect(report.raw_http_json_hash_matched).toBe(false);
    expect(JSON.stringify(report)).not.toContain(tenant);
  });
  it('fails closed for missing, multiple, mismatched and invalid server receipts',async()=>{
    const f=fixture();
    const ctx=validateEvidence(f.offline,f.recovered,f.id,f.offBytes,f.recBytes);
    const good={request_hash:hash,accepted_count:2,recorded_at_utc:'2026-11-18T00:00:00.000000Z'};
    await expect(verifyScopedReceipt(async()=>[],ctx)).rejects.toThrow('RECEIPT_NOT_UNIQUE_OR_NOT_FOUND');
    await expect(verifyScopedReceipt(async()=>[good,good],ctx)).rejects.toThrow('RECEIPT_NOT_UNIQUE_OR_NOT_FOUND');
    await expect(verifyScopedReceipt(async()=>[{...good,accepted_count:1}],ctx)).rejects.toThrow('RECEIPT_MISMATCH');
    await expect(verifyScopedReceipt(async()=>[{...good,request_hash:'not-a-hash'}],ctx)).rejects.toThrow('RECEIPT_MISMATCH');
    await expect(verifyScopedReceipt(async()=>[{...good,recorded_at_utc:'bad-time'}],ctx)).rejects.toThrow('RECEIPT_MISMATCH');
    await expect(verifyScopedReceipt(async()=>[good],{...ctx,batchId:"';DROP"})).rejects.toThrow('INVALID_OWNER_SCOPE');
  });
});
