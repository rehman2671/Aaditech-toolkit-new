// Diagnostic artifact review only: pins and expected context must be
// provided by trusted independent custody, never by the evidence itself.
// Verifies signature and binding, NOT collection authorization or truth.
import {createHash,createPublicKey,verify} from 'node:crypto';
import {troubleshootingCatalog} from './troubleshooting-policy.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
const digest=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&x!=='0'.repeat(64);
const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const fields=['schema','purpose','installation_id','tenant_id','device_id','incident_id','plan_id',
 'diagnostic_id','credential_fingerprint','challenge_sha256','artifact_sha256','issued_at_ms','expires_at_ms'];
const fail=()=>{throw Error('DIAGNOSTIC_EVIDENCE_UNVERIFIED')};
export function verifyDiagnosticEvidence({payload,signature,publicKeyPem,expected,nowMs}={}){
 if(!Buffer.isBuffer(payload)||payload.length<1||payload.length>4096||!Buffer.isBuffer(signature)||
    signature.length!==64||typeof publicKeyPem!=='string'||publicKeyPem.length>4096||
    !publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')||!expected||
    !Number.isSafeInteger(nowMs)||nowMs<=0||!digest(expected.payloadSha256)||!digest(expected.signerSpkiSha256))fail();
 const bytes=Buffer.from(payload),sig=Buffer.from(signature);
 if(sha(bytes)!==expected.payloadSha256)fail();
 let doc;
 try{
  const key=createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=='ed25519'||sha(key.export({type:'spki',format:'der'}))!==expected.signerSpkiSha256||
     !verify(null,bytes,key,sig))fail();
  doc=JSON.parse(bytes.toString('utf8'));
 }catch{fail()}
 if(!doc||typeof doc!=='object'||Array.isArray(doc)||Object.keys(doc).length!==fields.length||
    fields.some(k=>!Object.hasOwn(doc,k))||!Buffer.from(JSON.stringify(Object.fromEntries(fields.map(k=>[k,doc[k]])))).equals(bytes))fail();
 if(doc.schema!=='aaditech-diagnostic-evidence-v1'||doc.purpose!=='REVIEW_ONLY_DIAGNOSTIC_ARTIFACT'||
   ![doc.installation_id,doc.tenant_id,doc.device_id,doc.incident_id,doc.plan_id].every(uuid)||
   ![doc.credential_fingerprint,doc.challenge_sha256,doc.artifact_sha256].every(digest)||
   !troubleshootingCatalog.some(x=>x.diagnostic_id!==null&&x.diagnostic_id===doc.diagnostic_id))fail();
 for(const [field,k] of [['installation_id','installationId'],['tenant_id','tenantId'],['device_id','deviceId'],
  ['incident_id','incidentId'],['plan_id','planId'],['diagnostic_id','diagnosticId'],['credential_fingerprint','credentialFingerprint'],
  ['challenge_sha256','challengeSha256'],['artifact_sha256','artifactSha256']])if(doc[field]!==expected[k])fail();
 if(!Number.isSafeInteger(doc.issued_at_ms)||!Number.isSafeInteger(doc.expires_at_ms)||doc.issued_at_ms<=0||
    doc.issued_at_ms>nowMs||doc.expires_at_ms<=nowMs||doc.expires_at_ms-doc.issued_at_ms>300000)fail();
 return Object.freeze({signature_and_binding_verified:true,artifact_content_verified:false,
  attempt_executed:false,diagnostic_authorized:false,repair_authorized:false,verified_resolved:false,production_accepted:false});
}
