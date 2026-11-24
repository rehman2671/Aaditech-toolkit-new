// Phase O: offline verification boundary only. No database write, HTTP
// admission, grant consumption or credential issuance. The expected context,
// key pin, artifact digest and clock MUST be supplied by trusted local authority,
// never taken from the untrusted evidence envelope or an API request.
import {createHash,createPublicKey,verify} from 'node:crypto';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const keys=['schema','purpose','tenant_id','device_id','request_id','challenge_sha256',
  'credential_fingerprint','ownership_evidence_sha256','command_reconciliation_sha256',
  'local_handoff_evidence_sha256','issued_at_ms','expires_at_ms'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validDigest=x=>typeof x==='string'&&digest.test(x)&&x!=='0'.repeat(64);
const fail=()=>{throw new Error('RECOVERY_EVIDENCE_UNVERIFIED');};

export function verifyDeviceRecoveryEvidence({
  payload,signature,reviewerPublicKeyPem,expected,nowMs
}={}) {
  if (!Buffer.isBuffer(payload)||payload.length===0||payload.length>8192||
      !Buffer.isBuffer(signature)||signature.length!==64||
      typeof reviewerPublicKeyPem!=='string'||reviewerPublicKeyPem.length>4096||
      !expected||typeof expected!=='object'||Array.isArray(expected)||
      !Number.isSafeInteger(nowMs)||nowMs<=0) return fail();
  // Take immutable copies before interpreting data. Pins are not self-attested.
  const bytes=Buffer.from(payload),sig=Buffer.from(signature);
  if (!validDigest(expected.payloadSha256)||sha(bytes)!==expected.payloadSha256||
      !validDigest(expected.reviewerSpkiSha256)) return fail();
  let publicKey,doc;
  try {
    if (!reviewerPublicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')) return fail();
    publicKey=createPublicKey(reviewerPublicKeyPem);
    if(publicKey.asymmetricKeyType!=='ed25519'||
       sha(publicKey.export({type:'spki',format:'der'}))!==expected.reviewerSpkiSha256||
       !verify(null,bytes,publicKey,sig)) return fail();
    doc=JSON.parse(bytes.toString('utf8'));
  } catch (_) {return fail();}
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||
     Object.keys(doc).length!==keys.length||keys.some(k=>!Object.hasOwn(doc,k)))return fail();
  // Canonical ordered JSON prohibits duplicate keys, alternate whitespace,
  // trailing bytes, lossy UTF-8 decoding and noncanonical numeric forms.
  const canonical=Object.fromEntries(keys.map(k=>[k,doc[k]]));
  if(!Buffer.from(JSON.stringify(canonical),'utf8').equals(bytes))return fail();
  if(doc.schema!=='aaditech-device-recovery-evidence-v1'||
     doc.purpose!=='REVIEW_ONLY_CREDENTIAL_RECOVERY'||
     ![doc.tenant_id,doc.device_id,doc.request_id].every(x=>typeof x==='string'&&uuid.test(x))||
     ![doc.challenge_sha256,doc.credential_fingerprint,doc.ownership_evidence_sha256,
       doc.command_reconciliation_sha256,doc.local_handoff_evidence_sha256].every(validDigest))return fail();
  for(const [field,expectedField] of [
    ['tenant_id','tenantId'],['device_id','deviceId'],['request_id','requestId'],
    ['challenge_sha256','challengeSha256'],['credential_fingerprint','credentialFingerprint']
  ]) if(doc[field]!==expected[expectedField])return fail();
  if(!Number.isSafeInteger(doc.issued_at_ms)||!Number.isSafeInteger(doc.expires_at_ms)||
     doc.issued_at_ms<=0||doc.issued_at_ms>nowMs||doc.expires_at_ms<=nowMs||
     doc.expires_at_ms<=doc.issued_at_ms||doc.expires_at_ms-doc.issued_at_ms>300000)return fail();
  // This only verifies the reviewer signature and binding, not the truth of
  // referenced evidence. A durable CAS grant and independently verified endpoint
  // ownership/ACL handoff remain mandatory. Nothing returned is a credential.
  return Object.freeze({evidence_verified:true,request_id:doc.request_id,
    device_id:doc.device_id,tenant_id:doc.tenant_id,expires_at_ms:doc.expires_at_ms,
    evidence_sha256:expected.payloadSha256,grant_consumed:false,
    replacement_allowed:false,production_accepted:false});
}
