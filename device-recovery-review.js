// Review-only internal service. No HTTP route, credential issuance, activation
// or local handoff. Callers must authenticate the operator independently;
// reviewer key/artifact pins come only from trusted local configuration.
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {verifyDeviceRecoveryEvidence} from './device-recovery-evidence.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Error(code);};
const isUuid=x=>typeof x==='string'&&x.length===36&&uuid.test(x);
const isDigest=x=>typeof x==='string'&&x.length===64&&hex.test(x)&&x!=='0'.repeat(64);
const safeDbInt=x=>typeof x==='number'&&Number.isSafeInteger(x)?x:
  typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)&&String(Number(x))===x&&Number.isSafeInteger(Number(x))?Number(x):NaN;
function validPending(row,now){
  const created=safeDbInt(row.created_at_ms),expires=safeDbInt(row.expires_at_ms);
  return Number.isSafeInteger(created)&&created>0&&created<=now&&
    Number.isSafeInteger(expires)&&expires>created&&expires-created<=900000&&
    row.reviewer_id==null&&row.evidence_sha256==null&&row.reviewer_spki_sha256==null&&
    row.reviewed_at_ms==null&&row.review_expires_at_ms==null;
}
function validateContext(pool,principal,deviceId){
  if(!pool?.getConnection||!principal||!isUuid(principal.tenant_id)||
     !Number.isSafeInteger(principal.id)||principal.id<=0||
     principal.role!=='SUPER_ADMIN'||!isUuid(deviceId))fail('RECOVERY_REVIEW_INVALID');
}
async function transact(pool,fn){
  const c=await pool.getConnection();let committed=false,discard=false,commitStarted=false;
  try{
    await c.beginTransaction();
    const value=await fn(c);
    commitStarted=true;
    await c.commit();committed=true;return value;
  }finally{
    if(!committed){
      // A failed COMMIT has an unknown outcome. Never return its session to the pool.
      if(commitStarted)discard=true;
      try{await c.rollback();}catch(_){discard=true;}
      if(discard)c.destroy?.();
    }
    if(!discard)c.release();
  }
}
async function lockActiveAdmin(c,principal){
  const [users]=await c.query('SELECT id,tenant_id,role,active,status FROM users WHERE id=? AND tenant_id=? FOR UPDATE',
    [principal.id,principal.tenant_id]);
  const user=users?.length===1?users[0]:null;
  if(!user||safeDbInt(user.id)!==principal.id||user.tenant_id!==principal.tenant_id||
     user.role!=='SUPER_ADMIN'||![1,true,'1'].includes(user.active)||user.status!=='ACTIVE')fail('RECOVERY_REVIEW_ACTOR_DENIED');
}
async function lockContext(c,principal,deviceId,{deferActor=false}={}){
  // Always lock device before users/review row; revocation and command
  // mutations serialize on the same device row.
  const [owners]=await c.query(
    'SELECT id,tenant_id,device_token_hash,agent_token_revoked FROM devices WHERE id=? AND tenant_id=? FOR UPDATE',
    [deviceId,principal.tenant_id]);
  const owner=owners?.length===1?owners[0]:null;
  if(!owner||owner.id!==deviceId||owner.tenant_id!==principal.tenant_id||
     ![1,true,'1'].includes(owner.agent_token_revoked)||
     !isDigest(owner.device_token_hash))fail('RECOVERY_REVIEW_DEVICE_NOT_READY');
  if(!deferActor)await lockActiveAdmin(c,principal);
  const [counts]=await c.query(
    "SELECT (SELECT COUNT(*) FROM devices WHERE device_token_hash=?) AS matches_count, "+
    "(SELECT COUNT(*) FROM command_queue WHERE device_id=? AND (status IS NULL OR UPPER(status) NOT IN ('COMPLETED','FAILED','CANCELLED','EXPIRED'))) AS outstanding_count",
    [owner.device_token_hash,deviceId]);
  const n=counts?.[0];
  if(!n||n.matches_count==null||n.outstanding_count==null||safeDbInt(n.matches_count)!==1||safeDbInt(n.outstanding_count)!==0)fail('RECOVERY_REVIEW_DEVICE_NOT_READY');
  const [clock]=await c.query('SELECT CAST(UNIX_TIMESTAMP(NOW(3))*1000 AS UNSIGNED) AS now_ms');
  const now=safeDbInt(clock?.[0]?.now_ms);
  if(!Number.isSafeInteger(now)||now<=0)fail('RECOVERY_REVIEW_CLOCK_UNAVAILABLE');
  return {now,fingerprint:sha('aaditech:recovery-review:v1:'+owner.device_token_hash)};
}
async function audit(c,principal,deviceId,action,details){
  const [r]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',
    [randomUUID(),principal.tenant_id,principal.id,String(principal.id),action,'Device:'+deviceId,JSON.stringify(details),'127.0.0.1']);
  if(r?.affectedRows!==1)fail('RECOVERY_REVIEW_AUDIT_UNCONFIRMED');
}
export async function createRecoveryReviewRequest(pool,{principal,deviceId}={}){
  validateContext(pool,principal,deviceId);
  principal=Object.freeze({id:principal.id,tenant_id:principal.tenant_id,role:principal.role});
  return transact(pool,async c=>{
    const {now,fingerprint}=await lockContext(c,principal,deviceId);
    // Old generations and expired signed reservations are tombstones, not
    // active review locks. Preserve all records and their unique digests.
    const [active]=await c.query("SELECT request_id FROM device_recovery_reviews WHERE tenant_id=? AND device_id=? AND credential_fingerprint=? AND expires_at_ms>? AND (state='PENDING' OR (state='REVIEW_RESERVED' AND (review_expires_at_ms IS NULL OR review_expires_at_ms>?))) LIMIT 1 FOR UPDATE",
      [principal.tenant_id,deviceId,fingerprint,now,now]);
    if(!Array.isArray(active)||active.length)fail('RECOVERY_REVIEW_ALREADY_OPEN');
    const requestId=randomUUID(),challenge=sha(randomBytes(32)),expires=now+900000;
    const [r]=await c.query('INSERT INTO device_recovery_reviews (request_id,tenant_id,device_id,requester_id,challenge_sha256,credential_fingerprint,created_at_ms,expires_at_ms) VALUES (?,?,?,?,?,?,?,?)',
      [requestId,principal.tenant_id,deviceId,principal.id,challenge,fingerprint,now,expires]);
    if(r?.affectedRows!==1)fail('RECOVERY_REVIEW_WRITE_UNCONFIRMED');
    await audit(c,principal,deviceId,'DEVICE_RECOVERY_REVIEW_REQUESTED',{request_id:requestId});
    return Object.freeze({request_id:requestId,tenant_id:principal.tenant_id,device_id:deviceId,
      challenge_sha256:challenge,credential_fingerprint:fingerprint,expires_at_ms:expires,
      state:'PENDING',replacement_allowed:false,production_accepted:false});
  });
}
export async function reserveRecoveryReview(pool,{principal,deviceId,requestId,evidence,trustedPins}={}){
  validateContext(pool,principal,deviceId);
  if(!isUuid(requestId)||!evidence||!trustedPins||
     !Buffer.isBuffer(evidence.payload)||evidence.payload.length===0||evidence.payload.length>8192||
     !Buffer.isBuffer(evidence.signature)||evidence.signature.length!==64||
     !['payloadSha256','reviewerSpkiSha256','ownershipEvidenceSha256','commandReconciliationSha256','localHandoffEvidenceSha256'].every(k=>isDigest(trustedPins[k])&&trustedPins[k]!=='0'.repeat(64)))fail('RECOVERY_REVIEW_INVALID');
  // Copy mutable inputs before any asynchronous DB operation. Pins are
  // supplied by the trusted integration, not by the signed envelope.
  principal=Object.freeze({id:principal.id,tenant_id:principal.tenant_id,role:principal.role});
  evidence={payload:Buffer.from(evidence.payload),signature:Buffer.from(evidence.signature)};
  trustedPins=Object.freeze({...trustedPins});
  return transact(pool,async c=>{
    const {now,fingerprint}=await lockContext(c,principal,deviceId,{deferActor:true});
    const [rows]=await c.query('SELECT * FROM device_recovery_reviews WHERE request_id=? AND tenant_id=? AND device_id=? FOR UPDATE',
      [requestId,principal.tenant_id,deviceId]);
    const row=rows?.length===1?rows[0]:null;
    if(!row||row.request_id!==requestId||row.tenant_id!==principal.tenant_id||row.device_id!==deviceId||
       row.state!=='PENDING'||!validPending(row,now)||safeDbInt(row.requester_id)===principal.id||
       safeDbInt(row.expires_at_ms)<=now||
       row.credential_fingerprint!==fingerprint||!isDigest(row.challenge_sha256))fail('RECOVERY_REVIEW_NOT_RESERVABLE');
    // Both independent actors must still be authorized. Lock them in
    // deterministic ID order even when reviewing two different devices.
    const requesterId=safeDbInt(row.requester_id);
    if(!Number.isSafeInteger(requesterId)||requesterId<=0)fail('RECOVERY_REVIEW_NOT_RESERVABLE');
    for(const id of [requesterId,principal.id].sort((a,b)=>a-b))
      await lockActiveAdmin(c,{...principal,id});
    const checked=verifyDeviceRecoveryEvidence({
      payload:evidence.payload,signature:evidence.signature,reviewerPublicKeyPem:trustedPins.reviewerPublicKeyPem,
      expected:{payloadSha256:trustedPins.payloadSha256,reviewerSpkiSha256:trustedPins.reviewerSpkiSha256,
        tenantId:principal.tenant_id,deviceId,requestId,challengeSha256:row.challenge_sha256,credentialFingerprint:fingerprint},
      nowMs:now});
    const signed=JSON.parse(evidence.payload.toString('utf8'));
    if(signed.ownership_evidence_sha256!==trustedPins.ownershipEvidenceSha256||
       signed.command_reconciliation_sha256!==trustedPins.commandReconciliationSha256||
       signed.local_handoff_evidence_sha256!==trustedPins.localHandoffEvidenceSha256)fail('RECOVERY_REVIEW_ARTIFACT_MISMATCH');
    // Re-read DB time after acquiring both administrator locks and verifying
    // signature, so waiting on a lock cannot extend the review window.
    const [clock]=await c.query('SELECT CAST(UNIX_TIMESTAMP(NOW(3))*1000 AS UNSIGNED) AS now_ms');
    const commitNow=safeDbInt(clock?.[0]?.now_ms);
    if(!Number.isSafeInteger(commitNow)||commitNow<now||checked.expires_at_ms<=commitNow||
       checked.expires_at_ms>safeDbInt(row.expires_at_ms))fail('RECOVERY_REVIEW_NOT_RESERVABLE');
    const [updated]=await c.query("UPDATE device_recovery_reviews SET state='REVIEW_RESERVED',reviewer_id=?,evidence_sha256=?,reviewer_spki_sha256=?,reviewed_at_ms=?,review_expires_at_ms=? WHERE request_id=? AND tenant_id=? AND device_id=? AND state='PENDING' AND expires_at_ms>?",
      [principal.id,checked.evidence_sha256,trustedPins.reviewerSpkiSha256,commitNow,checked.expires_at_ms,requestId,principal.tenant_id,deviceId,commitNow]);
    if(updated?.affectedRows!==1)fail('RECOVERY_REVIEW_WRITE_UNCONFIRMED');
    await audit(c,principal,deviceId,'DEVICE_RECOVERY_REVIEW_RESERVED',{request_id:requestId,evidence_sha256:checked.evidence_sha256});
    return Object.freeze({request_id:requestId,state:'REVIEW_RESERVED',review_reserved:true,
      grant_consumed:false,replacement_allowed:false,production_accepted:false});
  });
}

/**
 * Internal, read-only review status for an authenticated active tenant admin.
 * This is not an activation authorization, and never returns proof material.
 * The current revoked credential and outstanding-command gates are rechecked.
 */
export async function inspectRecoveryReview(pool,{principal,deviceId,requestId}={}){
  validateContext(pool,principal,deviceId);
  if(!isUuid(requestId))fail('RECOVERY_REVIEW_INVALID');
  principal=Object.freeze({id:principal.id,tenant_id:principal.tenant_id,role:principal.role});
  return transact(pool,async c=>{
    const {now,fingerprint}=await lockContext(c,principal,deviceId,{deferActor:true});
    const [rows]=await c.query('SELECT * FROM device_recovery_reviews WHERE request_id=? AND tenant_id=? AND device_id=? FOR UPDATE',
      [requestId,principal.tenant_id,deviceId]);
    const row=rows?.length===1?rows[0]:null;
    if(!row||row.request_id!==requestId||row.tenant_id!==principal.tenant_id||row.device_id!==deviceId)fail('RECOVERY_REVIEW_NOT_FOUND');
    const requesterId=safeDbInt(row.requester_id),reviewerId=safeDbInt(row.reviewer_id);
    const expires=safeDbInt(row.expires_at_ms),created=safeDbInt(row.created_at_ms);
    if(!Number.isSafeInteger(requesterId)||requesterId<=0||
       !Number.isSafeInteger(created)||created<=0||created>now||!Number.isSafeInteger(expires)||expires<=created||expires-created>900000||
       !['PENDING','REVIEW_RESERVED'].includes(row.state)||!isDigest(row.credential_fingerprint)||
       !isDigest(row.challenge_sha256))fail('RECOVERY_REVIEW_STATE_INVALID');
    const reserved=row.state==='REVIEW_RESERVED';
    const reviewExpiry=safeDbInt(row.review_expires_at_ms),reviewed=safeDbInt(row.reviewed_at_ms);
    if(!reserved&&!validPending(row,now))fail('RECOVERY_REVIEW_STATE_INVALID');
    if(reserved&&(!Number.isSafeInteger(reviewerId)||reviewerId<=0||reviewerId===requesterId||
       !Number.isSafeInteger(reviewed)||reviewed<created||reviewed>now||!Number.isSafeInteger(reviewExpiry)||
       reviewExpiry<=reviewed||reviewExpiry>expires||reviewExpiry-reviewed>300000||!isDigest(row.evidence_sha256)||!isDigest(row.reviewer_spki_sha256)))
       fail('RECOVERY_REVIEW_STATE_INVALID');
    for(const id of [...new Set([principal.id,requesterId,...(reserved?[reviewerId]:[])])].sort((a,b)=>a-b))
      await lockActiveAdmin(c,{...principal,id});
    const [clock]=await c.query('SELECT CAST(UNIX_TIMESTAMP(NOW(3))*1000 AS UNSIGNED) AS now_ms');
    const checkedNow=safeDbInt(clock?.[0]?.now_ms);
    if(!Number.isSafeInteger(checkedNow)||checkedNow<now)fail('RECOVERY_REVIEW_CLOCK_UNAVAILABLE');
    const status=row.credential_fingerprint!==fingerprint?'STALE_CREDENTIAL':
      checkedNow>=expires||(reserved&&checkedNow>=reviewExpiry)?'EXPIRED':row.state;
    return Object.freeze({request_id:requestId,tenant_id:principal.tenant_id,device_id:deviceId,
      status,expires_at_ms:reserved?reviewExpiry:expires,checked_at_ms:checkedNow,
      replacement_allowed:false,grant_consumed:false,production_accepted:false});
  });
}
