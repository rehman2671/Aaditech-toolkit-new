import {describe,it,expect,vi} from 'vitest';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createRecoveryReviewRequest,reserveRecoveryReview} from '../../device-recovery-review.js';
const tenant='00000000-0000-4000-8000-000000000011',device='00000000-0000-4000-8000-000000000012',request='00000000-0000-4000-8000-000000000013';
const now=1700000000000,tokenHash='b'.repeat(64),sha=x=>createHash('sha256').update(x).digest('hex');
const fingerprint=sha('aaditech:recovery-review:v1:'+tokenHash);
const requester={id:1,tenant_id:tenant,role:'SUPER_ADMIN'},reviewer={...requester,id:2};
const persisted={request_id:request,tenant_id:tenant,device_id:device,requester_id:1,state:'PENDING',challenge_sha256:'a'.repeat(64),credential_fingerprint:fingerprint,expires_at_ms:now+10000};
function fixture({ownerPatch={},userPatch={},requesterPatch={},secondClock=now,counts={matches_count:1,outstanding_count:0},rowPatch={},active=[],auditRows=1,writeRows=1}={}){
  let clockReads=0;
  const conn={beginTransaction:vi.fn(async()=>{}),commit:vi.fn(async()=>{}),rollback:vi.fn(async()=>{}),release:vi.fn(),
    query:vi.fn(async(sql,args)=>{
      if(sql.startsWith('SELECT id,tenant_id,device_token_hash'))return [[{id:device,tenant_id:tenant,device_token_hash:tokenHash,agent_token_revoked:1,...ownerPatch}]];
      if(sql.startsWith('SELECT id,tenant_id,role'))return [[{id:args[0],tenant_id:tenant,role:'SUPER_ADMIN',active:1,status:'ACTIVE',...userPatch,...(args[0]===requester.id?requesterPatch:{})}]];
      if(sql.startsWith('SELECT (SELECT COUNT'))return [[counts]];
      if(sql.startsWith('SELECT CAST'))return [[{now_ms:clockReads++?secondClock:now}]];
      if(sql.startsWith('SELECT request_id'))return [active];
      if(sql.startsWith('SELECT * FROM device_recovery_reviews'))return [[{...persisted,...rowPatch}]];
      if(sql.startsWith('INSERT INTO audit_logs'))return [{affectedRows:auditRows}];
      if(sql.startsWith('INSERT INTO device_recovery_reviews')||sql.startsWith('UPDATE device_recovery_reviews'))return [{affectedRows:writeRows}];
      throw Error('unexpected SQL '+sql);
    })};
  return {conn,pool:{getConnection:async()=>conn}};
}
function proof(){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const payload=Buffer.from(JSON.stringify({schema:'aaditech-device-recovery-evidence-v1',purpose:'REVIEW_ONLY_CREDENTIAL_RECOVERY',tenant_id:tenant,device_id:device,request_id:request,challenge_sha256:persisted.challenge_sha256,credential_fingerprint:fingerprint,ownership_evidence_sha256:'c'.repeat(64),command_reconciliation_sha256:'d'.repeat(64),local_handoff_evidence_sha256:'e'.repeat(64),issued_at_ms:now-100,expires_at_ms:now+1000}));
  return {evidence:{payload,signature:sign(null,payload,privateKey)},trustedPins:{payloadSha256:sha(payload),reviewerSpkiSha256:sha(publicKey.export({type:'spki',format:'der'})),reviewerPublicKeyPem:publicKey.export({type:'spki',format:'pem'}),ownershipEvidenceSha256:'c'.repeat(64),commandReconciliationSha256:'d'.repeat(64),localHandoffEvidenceSha256:'e'.repeat(64)}};
}
describe('review-only recovery reservations',()=>{
  it('creates a bounded request with persistent authority and atomic audit',async()=>{
    const {pool,conn}=fixture();const result=await createRecoveryReviewRequest(pool,{principal:requester,deviceId:device});
    expect(result).toMatchObject({state:'PENDING',expires_at_ms:now+900000,credential_fingerprint:fingerprint,replacement_allowed:false,production_accepted:false});
    expect(result.challenge_sha256).toMatch(/^[a-f0-9]{64}$/);expect(conn.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(conn.commit).toHaveBeenCalledOnce();
  });
  it('rejects active, foreign, ambiguous or unresolved device state and inactive operator',async()=>{
    for(const opts of [{ownerPatch:{agent_token_revoked:0}},{ownerPatch:{tenant_id:'foreign'}},{counts:{matches_count:2,outstanding_count:0}},{counts:{matches_count:1,outstanding_count:1}},{userPatch:{active:0}},{active:[{request_id:request}]}]){
      const {pool,conn}=fixture(opts);await expect(createRecoveryReviewRequest(pool,{principal:requester,deviceId:device})).rejects.toThrow();
      expect(conn.rollback).toHaveBeenCalledOnce();expect(conn.commit).not.toHaveBeenCalled();
    }
  });
  it('reserves a signed review exactly once without credential activation',async()=>{
    const {pool,conn}=fixture();const result=await reserveRecoveryReview(pool,{principal:reviewer,deviceId:device,requestId:request,...proof()});
    expect(result).toEqual({request_id:request,state:'REVIEW_RESERVED',review_reserved:true,grant_consumed:false,replacement_allowed:false,production_accepted:false});
    expect(conn.query.mock.calls.some(([sql])=>sql.includes("AND state='PENDING'"))).toBe(true);
    expect(conn.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE devices'))).toBe(false);
    expect(conn.commit).toHaveBeenCalledOnce();
  });
  it('denies same reviewer, stale generation, expired request and replay',async()=>{
    for(const [opts,principal] of [[{},requester],[{rowPatch:{credential_fingerprint:'f'.repeat(64)}},reviewer],[{rowPatch:{expires_at_ms:now}},reviewer],[{rowPatch:{state:'REVIEW_RESERVED'}},reviewer]]){
      const {pool,conn}=fixture(opts);await expect(reserveRecoveryReview(pool,{principal,deviceId:device,requestId:request,...proof()})).rejects.toThrow('RECOVERY_REVIEW_NOT_RESERVABLE');
      expect(conn.rollback).toHaveBeenCalledOnce();
    }
  });
  it('rolls back bad signature, failed CAS and audit',async()=>{
    for(const opts of [{writeRows:0},{auditRows:0}]){
      const {pool,conn}=fixture(opts);await expect(reserveRecoveryReview(pool,{principal:reviewer,deviceId:device,requestId:request,...proof()})).rejects.toThrow();
      expect(conn.rollback).toHaveBeenCalledOnce();expect(conn.commit).not.toHaveBeenCalled();
    }
    const {pool,conn}=fixture();const p=proof();p.evidence.signature=Buffer.alloc(64);
    await expect(reserveRecoveryReview(pool,{principal:reviewer,deviceId:device,requestId:request,...p})).rejects.toThrow('RECOVERY_EVIDENCE_UNVERIFIED');expect(conn.rollback).toHaveBeenCalledOnce();
  });
});

describe('review reservation live actor and evidence continuity',()=>{
  it('revalidates requester and reviewer in deterministic order; expired after lock is denied',async()=>{
    const {pool,conn}=fixture();
    await reserveRecoveryReview(pool,{principal:reviewer,deviceId:device,requestId:request,...proof()});
    expect(conn.query.mock.calls.filter(([sql])=>sql.startsWith('SELECT id,tenant_id,role')).map(([,args])=>args[0])).toEqual([1,2]);
    for(const opts of [{requesterPatch:{active:0}},{requesterPatch:{role:'OPERATOR'}},{secondClock:now+1000},{secondClock:now-1}]){
      const f=fixture(opts);
      await expect(reserveRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request,...proof()})).rejects.toThrow();
      expect(f.conn.rollback).toHaveBeenCalledOnce();
      expect(f.conn.commit).not.toHaveBeenCalled();
    }
  });
  it('requires all three independently pinned artifact digests',async()=>{
    for(const field of ['ownershipEvidenceSha256','commandReconciliationSha256','localHandoffEvidenceSha256']){
      const f=fixture(),p=proof();
      p.trustedPins[field]='f'.repeat(64);
      await expect(reserveRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request,...p})).rejects.toThrow('RECOVERY_REVIEW_ARTIFACT_MISMATCH');
      expect(f.conn.rollback).toHaveBeenCalledOnce();
    }
  });
  it('snapshots evidence and principal before the first await',async()=>{
    const f=fixture(),p=proof(),actor={...reviewer};
    const pending=reserveRecoveryReview(f.pool,{principal:actor,deviceId:device,requestId:request,...p});
    p.evidence.payload.fill(0);p.evidence.signature.fill(0);
    p.trustedPins.ownershipEvidenceSha256='f'.repeat(64);actor.id=1;
    expect((await pending).review_reserved).toBe(true);
  });
});
