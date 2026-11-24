// Review-only internal service. No HTTP route, credential issuance, activation
// or local handoff. Callers must authenticate the operator independently;
// reviewer key/artifact pins come only from trusted local configuration.
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {verifyDeviceRecoveryEvidence} from './device-recovery-evidence.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Error(code);};
function validateContext(pool,principal,deviceId){
  if(!pool?.getConnection||!principal||!uuid.test(principal.tenant_id||'')||
     !Number.isSafeInteger(principal.id)||principal.id<=0||
     principal.role!=='SUPER_ADMIN'||typeof deviceId!=='string'||!uuid.test(deviceId))fail('RECOVERY_REVIEW_INVALID');
}
async function transact(pool,fn){
  const c=await pool.getConnection();let committed=false,discard=false;
  try{
    await c.beginTransaction();
    const value=await fn(c);
    await c.commit();committed=true;return value;
  }finally{
    if(!committed){try{await c.rollback();}catch(_){discard=true;c.destroy?.();}}
    if(!discard)c.release();
  }
}
async function lockContext(c,principal,deviceId){
  // Always lock device before users/review row; revocation and command
  // mutations serialize on the same device row.
  const [owners]=await c.query(
    'SELECT id,tenant_id,device_token_hash,agent_token_revoked FROM devices WHERE id=? AND tenant_id=? FOR UPDATE',
    [deviceId,principal.tenant_id]);
  const owner=owners?.length===1?owners[0]:null;
  if(!owner||owner.id!==deviceId||owner.tenant_id!==principal.tenant_id||
     ![1,true,'1'].includes(owner.agent_token_revoked)||
     typeof owner.device_token_hash!=='string'||!hex.test(owner.device_token_hash))fail('RECOVERY_REVIEW_DEVICE_NOT_READY');
  const [users]=await c.query('SELECT id,tenant_id,role,active,status FROM users WHERE id=? AND tenant_id=? FOR UPDATE',
    [principal.id,principal.tenant_id]);
  const user=users?.length===1?users[0]:null;
  if(!user||Number(user.id)!==principal.id||user.tenant_id!==principal.tenant_id||
     user.role!=='SUPER_ADMIN'||![1,true,'1'].includes(user.active)||user.status!=='ACTIVE')fail('RECOVERY_REVIEW_ACTOR_DENIED');
  const [counts]=await c.query(
    "SELECT (SELECT COUNT(*) FROM devices WHERE device_token_hash=?) AS matches_count, "+
    "(SELECT COUNT(*) FROM command_queue WHERE device_id=? AND (status IS NULL OR UPPER(status) NOT IN ('COMPLETED','FAILED','CANCELLED','EXPIRED'))) AS outstanding_count",
    [owner.device_token_hash,deviceId]);
  const n=counts?.[0];
  if(!n||n.matches_count==null||n.outstanding_count==null||Number(n.matches_count)!==1||Number(n.outstanding_count)!==0)fail('RECOVERY_REVIEW_DEVICE_NOT_READY');
  const [clock]=await c.query('SELECT CAST(UNIX_TIMESTAMP(NOW(3))*1000 AS UNSIGNED) AS now_ms');
  const now=Number(clock?.[0]?.now_ms);
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
  return transact(pool,async c=>{
    const {now,fingerprint}=await lockContext(c,principal,deviceId);
    const [active]=await c.query('SELECT request_id FROM device_recovery_reviews WHERE tenant_id=? AND device_id=? AND expires_at_ms>? LIMIT 1 FOR UPDATE',
      [principal.tenant_id,deviceId,now]);
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
  if(typeof requestId!=='string'||!uuid.test(requestId)||!evidence||!trustedPins)fail('RECOVERY_REVIEW_INVALID');
  return transact(pool,async c=>{
    const {now,fingerprint}=await lockContext(c,principal,deviceId);
    const [rows]=await c.query('SELECT * FROM device_recovery_reviews WHERE request_id=? AND tenant_id=? AND device_id=? FOR UPDATE',
      [requestId,principal.tenant_id,deviceId]);
    const row=rows?.length===1?rows[0]:null;
    if(!row||row.request_id!==requestId||row.tenant_id!==principal.tenant_id||row.device_id!==deviceId||
       row.state!=='PENDING'||Number(row.requester_id)===principal.id||
       !Number.isSafeInteger(Number(row.expires_at_ms))||Number(row.expires_at_ms)<=now||
       row.credential_fingerprint!==fingerprint||!hex.test(row.challenge_sha256||''))fail('RECOVERY_REVIEW_NOT_RESERVABLE');
    const checked=verifyDeviceRecoveryEvidence({
      payload:evidence.payload,signature:evidence.signature,reviewerPublicKeyPem:trustedPins.reviewerPublicKeyPem,
      expected:{payloadSha256:trustedPins.payloadSha256,reviewerSpkiSha256:trustedPins.reviewerSpkiSha256,
        tenantId:principal.tenant_id,deviceId,requestId,challengeSha256:row.challenge_sha256,credentialFingerprint:fingerprint},
      nowMs:now});
    if(checked.expires_at_ms>Number(row.expires_at_ms))fail('RECOVERY_REVIEW_NOT_RESERVABLE');
    const [updated]=await c.query("UPDATE device_recovery_reviews SET state='REVIEW_RESERVED',reviewer_id=?,evidence_sha256=?,reviewer_spki_sha256=?,reviewed_at_ms=?,review_expires_at_ms=? WHERE request_id=? AND tenant_id=? AND device_id=? AND state='PENDING' AND expires_at_ms>?",
      [principal.id,checked.evidence_sha256,trustedPins.reviewerSpkiSha256,now,checked.expires_at_ms,requestId,principal.tenant_id,deviceId,now]);
    if(updated?.affectedRows!==1)fail('RECOVERY_REVIEW_WRITE_UNCONFIRMED');
    await audit(c,principal,deviceId,'DEVICE_RECOVERY_REVIEW_RESERVED',{request_id:requestId,evidence_sha256:checked.evidence_sha256});
    return Object.freeze({request_id:requestId,state:'REVIEW_RESERVED',review_reserved:true,
      grant_consumed:false,replacement_allowed:false,production_accepted:false});
  });
}
