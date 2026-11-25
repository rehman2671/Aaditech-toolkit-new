import {describe,it,expect,vi} from 'vitest';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createRecoveryReviewRequest,reserveRecoveryReview,inspectRecoveryReview} from '../../device-recovery-review.js';
const tenant='00000000-0000-4000-8000-000000000011',device='00000000-0000-4000-8000-000000000012',request='00000000-0000-4000-8000-000000000013';
const now=1700000000000,tokenHash='b'.repeat(64),sha=x=>createHash('sha256').update(x).digest('hex');
const fingerprint=sha('aaditech:recovery-review:v1:'+tokenHash);
const requester={id:1,tenant_id:tenant,role:'SUPER_ADMIN'},reviewer={...requester,id:2};
const persisted={request_id:request,tenant_id:tenant,device_id:device,requester_id:1,state:'PENDING',challenge_sha256:'a'.repeat(64),credential_fingerprint:fingerprint,created_at_ms:now-1000,expires_at_ms:now+10000};
function fixture({ownerPatch={},userPatch={},requesterPatch={},secondClock=now,firstClockRows=null,secondClockRows=null,countRows=null,counts={matches_count:1,outstanding_count:0},rowPatch={},active=[],auditRows=1,writeRows=1,commitFails=false}={}){
  let clockReads=0;
  const conn={beginTransaction:vi.fn(async()=>{}),commit:vi.fn(async()=>{if(commitFails)throw Error('COMMIT_OUTCOME_UNKNOWN')}),rollback:vi.fn(async()=>{}),release:vi.fn(),destroy:vi.fn(),
    query:vi.fn(async(sql,args)=>{
      if(sql.startsWith('SELECT id,tenant_id,device_token_hash'))return [[{id:device,tenant_id:tenant,device_token_hash:tokenHash,agent_token_revoked:1,...ownerPatch}]];
      if(sql.startsWith('SELECT id,tenant_id,role'))return [[{id:args[0],tenant_id:tenant,role:'SUPER_ADMIN',active:1,status:'ACTIVE',...userPatch,...(args[0]===requester.id?requesterPatch:{})}]];
      if(sql.startsWith('SELECT (SELECT COUNT'))return [countRows??[counts]];
      if(sql.startsWith('SELECT CAST'))return [clockReads++?(secondClockRows??[{now_ms:secondClock}]):(firstClockRows??[{now_ms:now}])];
      if(sql.startsWith('SELECT request_id'))return [active];
      if(sql.startsWith('SELECT * FROM device_recovery_reviews'))return [[{...persisted,...rowPatch}]];
      if(sql.startsWith('INSERT INTO audit_logs'))return [{affectedRows:auditRows}];
      if(sql.startsWith('INSERT INTO device_recovery_reviews')||sql.startsWith('UPDATE device_recovery_reviews'))return [{affectedRows:writeRows}];
      throw Error('unexpected SQL '+sql);
    })};
  return {conn,pool:{getConnection:async()=>conn}};
}
function proof(issued=now-100){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const payload=Buffer.from(JSON.stringify({schema:'aaditech-device-recovery-evidence-v1',purpose:'REVIEW_ONLY_CREDENTIAL_RECOVERY',tenant_id:tenant,device_id:device,request_id:request,challenge_sha256:persisted.challenge_sha256,credential_fingerprint:fingerprint,ownership_evidence_sha256:'c'.repeat(64),command_reconciliation_sha256:'d'.repeat(64),local_handoff_evidence_sha256:'e'.repeat(64),issued_at_ms:issued,expires_at_ms:now+1000}));
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

it('rejects coercible identity and malformed exact-length authority before starting a review',async()=>{
  for(const args of [{principal:{...requester,tenant_id:[tenant]},deviceId:device},
    {principal:{...requester,tenant_id:tenant+'\n'},deviceId:device},
    {principal:requester,deviceId:device+'\n'}]){
    const f=fixture();
    await expect(createRecoveryReviewRequest(f.pool,args)).rejects.toThrow('RECOVERY_REVIEW_INVALID');
    expect(f.conn.beginTransaction).not.toHaveBeenCalled();
  }
  const f=fixture(),p=proof();
  p.trustedPins.ownershipEvidenceSha256+='\n';
  await expect(reserveRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request,...p})).rejects.toThrow('RECOVERY_REVIEW_INVALID');
  expect(f.conn.beginTransaction).not.toHaveBeenCalled();
});

describe('read-only recovery lifecycle status',()=>{
  const inspect=f=>inspectRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request});
  const common={created_at_ms:now-1000};
  const reserved={...common,state:'REVIEW_RESERVED',reviewer_id:2,reviewed_at_ms:now-100,
    review_expires_at_ms:now+500,evidence_sha256:'c'.repeat(64),reviewer_spki_sha256:'d'.repeat(64)};
  it('returns only categorical status, never a grant, raw fingerprint or challenge',async()=>{
    for(const [rowPatch,secondClock,status] of [[common,now,'PENDING'],[reserved,now,'REVIEW_RESERVED'],
      [reserved,now+500,'EXPIRED'],[{...common,credential_fingerprint:'f'.repeat(64)},now,'STALE_CREDENTIAL']]){
      const f=fixture({rowPatch,secondClock});const result=await inspect(f);
      expect(result).toMatchObject({status,replacement_allowed:false,grant_consumed:false,production_accepted:false});
      expect(result).not.toHaveProperty('credential_fingerprint');expect(result).not.toHaveProperty('challenge_sha256');
      expect(f.conn.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
      expect(f.conn.commit).toHaveBeenCalledOnce();
    }
  });
  it('denies malformed or foreign rows, inactive actors, and clock regression',async()=>{
    for(const opts of [{rowPatch:{...common,tenant_id:'foreign'}},{rowPatch:{...reserved,reviewer_id:1}},
      {rowPatch:{...reserved,evidence_sha256:null}},{rowPatch:common,requesterPatch:{active:0}},
      {rowPatch:common,secondClock:now-1}]){
      const f=fixture(opts);await expect(inspect(f)).rejects.toThrow();
      expect(f.conn.rollback).toHaveBeenCalledOnce();
    }
  });
});

it('blocks only active current-generation review windows without deleting tombstones',async()=>{
  const f=fixture();
  await createRecoveryReviewRequest(f.pool,{principal:requester,deviceId:device});
  const [sql,args]=f.conn.query.mock.calls.find(([q])=>q.startsWith('SELECT request_id'));
  expect(sql).toContain('credential_fingerprint=?');
  expect(sql).toContain('review_expires_at_ms>?');
  expect(args).toEqual([tenant,device,fingerprint,now,now]);
  expect(f.conn.query.mock.calls.some(([q])=>q.startsWith('DELETE'))).toBe(false);
});

describe('persisted recovery state and uncertain transaction boundaries',()=>{
  it('rejects inconsistent pending rows before any reserve mutation or status projection',async()=>{
    for(const rowPatch of [
      {created_at_ms:now+1},{created_at_ms:null},{created_at_ms:' 1700000000000'},
      {expires_at_ms:now+900001},{reviewer_id:2},{evidence_sha256:'e'.repeat(64)},
      {reviewed_at_ms:now},{review_expires_at_ms:now+1},{reviewer_spki_sha256:'a'.repeat(64)}
    ]){
      const f=fixture({rowPatch});
      await expect(reserveRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request,...proof()})).rejects.toThrow('RECOVERY_REVIEW_NOT_RESERVABLE');
      expect(f.conn.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE device_recovery_reviews'))).toBe(false);
      const g=fixture({rowPatch});
      await expect(inspectRecoveryReview(g.pool,{principal:reviewer,deviceId:device,requestId:request})).rejects.toThrow('RECOVERY_REVIEW_STATE_INVALID');
    }
  });
  it('rejects noncanonical DB counts or timestamps and zero credential digests',async()=>{
    for(const opts of [{counts:{matches_count:true,outstanding_count:0}},
      {counts:{matches_count:1,outstanding_count:' '}},{ownerPatch:{device_token_hash:'0'.repeat(64)}},
      {secondClock:now+' '}]) {
      const f=fixture(opts);
      await expect(reserveRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request,...proof()})).rejects.toThrow();
      expect(f.conn.commit).not.toHaveBeenCalled();
    }
  });
  it('rejects future or overlong persisted reservations',async()=>{
    for(const rowPatch of [
      {reviewed_at_ms:now+1,review_expires_at_ms:now+500},
      {reviewed_at_ms:now-100,review_expires_at_ms:now+300001,expires_at_ms:now+600000}
    ]){
      const f=fixture({rowPatch:{state:'REVIEW_RESERVED',reviewer_id:2,
        evidence_sha256:'e'.repeat(64),reviewer_spki_sha256:'f'.repeat(64),...rowPatch}});
      await expect(inspectRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request})).rejects.toThrow('RECOVERY_REVIEW_STATE_INVALID');
    }
  });
  it('discards the DB session on uncertain commit even when rollback succeeds',async()=>{
    const f=fixture({commitFails:true});
    await expect(createRecoveryReviewRequest(f.pool,{principal:requester,deviceId:device})).rejects.toThrow('COMMIT_OUTCOME_UNKNOWN');
    expect(f.conn.rollback).toHaveBeenCalledOnce();
    expect(f.conn.destroy).toHaveBeenCalledOnce();
    expect(f.conn.release).not.toHaveBeenCalled();
  });
});

describe('Recovery review clock and evidence causality',()=>{
  for(const [i,rows] of [[],[{now_ms:now},{now_ms:now}],[{}],[{now_ms:null}],[{now_ms:true}],[{now_ms:-1}],[{now_ms:0}],[{now_ms:now+'.0'}],[{now_ms:'0'.repeat(17)}],[{now_ms:Number.MAX_SAFE_INTEGER}],[{now_ms:Infinity}]].entries()){
    it('rejects untrusted initial DB clock '+i,async()=>{
      const f=fixture({firstClockRows:rows});
      await expect(createRecoveryReviewRequest(f.pool,{principal:requester,deviceId:device})).rejects.toThrow('RECOVERY_REVIEW_CLOCK_UNAVAILABLE');
      expect(f.conn.commit).not.toHaveBeenCalled();
      expect(f.conn.query.mock.calls.some(([q])=>q.startsWith('INSERT'))).toBe(false);
    });
    it('rejects untrusted recheck DB clock '+i,async()=>{
      const f=fixture({secondClockRows:rows});
      await expect(reserveRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request,...proof()})).rejects.toThrow('RECOVERY_REVIEW_CLOCK_UNAVAILABLE');
      expect(f.conn.commit).not.toHaveBeenCalled();
      expect(f.conn.query.mock.calls.some(([q])=>q.startsWith('UPDATE'))).toBe(false);
      const g=fixture({secondClockRows:rows});
      await expect(inspectRecoveryReview(g.pool,{principal:reviewer,deviceId:device,requestId:request})).rejects.toThrow('RECOVERY_REVIEW_CLOCK_UNAVAILABLE');
    });
  }
  for(const [i,rows] of [[],[{matches_count:1,outstanding_count:0},{matches_count:1,outstanding_count:0}],[{}],[{matches_count:1,outstanding_count:-1}],[{matches_count:'01',outstanding_count:0}],[{matches_count:1,outstanding_count:'0'.repeat(17)}]].entries())
    it('rejects ambiguous count rows '+i,async()=>{
      const f=fixture({countRows:rows});
      await expect(createRecoveryReviewRequest(f.pool,{principal:requester,deviceId:device})).rejects.toThrow('RECOVERY_REVIEW_DEVICE_NOT_READY');
      expect(f.conn.commit).not.toHaveBeenCalled();
    });
  for(const issued of [now-1001,now-2000,now-20000])
    it('rejects valid signature predating persisted challenge '+issued,async()=>{
      const f=fixture();
      await expect(reserveRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request,...proof(issued)})).rejects.toThrow('RECOVERY_REVIEW_EVIDENCE_PREDATES_REQUEST');
      expect(f.conn.query.mock.calls.some(([q])=>q.startsWith('UPDATE'))).toBe(false);
      expect(f.conn.commit).not.toHaveBeenCalled();
    });
  it('accepts a review signed at request creation without consuming a grant',async()=>{
    const f=fixture();
    expect(await reserveRecoveryReview(f.pool,{principal:reviewer,deviceId:device,requestId:request,...proof(now-1000)})).toMatchObject({review_reserved:true,grant_consumed:false,replacement_allowed:false});
  });
});
