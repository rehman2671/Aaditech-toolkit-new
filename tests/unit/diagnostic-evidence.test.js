import {describe,it,expect} from 'vitest';
import {randomUUID,generateKeyPairSync,createHash,sign} from 'node:crypto';
import {verifyDiagnosticEvidence as verify,verifyResourceDiagnosticArtifact} from '../../diagnostic-evidence.js';
const sha=x=>createHash('sha256').update(x).digest('hex'),nowMs=1700000000000;
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const expected={installationId:randomUUID(),tenantId:randomUUID(),deviceId:randomUUID(),incidentId:randomUUID(),planId:randomUUID(),
 diagnosticId:'RESOURCE_PRESSURE',credentialFingerprint:'a'.repeat(64),challengeSha256:'b'.repeat(64),artifactSha256:'c'.repeat(64),
 signerSpkiSha256:sha(publicKey.export({type:'spki',format:'der'}))};
const base={schema:'aaditech-diagnostic-evidence-v1',purpose:'REVIEW_ONLY_DIAGNOSTIC_ARTIFACT',
 installation_id:expected.installationId,tenant_id:expected.tenantId,device_id:expected.deviceId,incident_id:expected.incidentId,
 plan_id:expected.planId,diagnostic_id:expected.diagnosticId,credential_fingerprint:expected.credentialFingerprint,
 challenge_sha256:expected.challengeSha256,artifact_sha256:expected.artifactSha256,issued_at_ms:nowMs-1000,expires_at_ms:nowMs+1000};
function args(patch={}){
 const payload=Buffer.from(JSON.stringify({...base,...patch}));
 return {payload,signature:sign(null,payload,privateKey),publicKeyPem:publicKey.export({type:'spki',format:'pem'}),expected:{...expected,payloadSha256:sha(payload)},nowMs};
}
describe('diagnostic artifact review-only evidence',()=>{
 it('verifies the signature but never claims execution, artifact truth or repair',()=>{
  expect(verify(args())).toEqual({signature_and_binding_verified:true,artifact_content_verified:false,attempt_executed:false,
   diagnostic_authorized:false,repair_authorized:false,verified_resolved:false,production_accepted:false});
 });
 it('rejects signed mismatched context, expiry and noncanonical or extra fields',()=>{
  for(const patch of [{tenant_id:randomUUID()},{plan_id:randomUUID()},{diagnostic_id:'UNKNOWN'},{challenge_sha256:'d'.repeat(64)},
   {artifact_sha256:'d'.repeat(64)},{credential_fingerprint:'d'.repeat(64)},{purpose:'EXECUTE'},{expires_at_ms:nowMs},
   {issued_at_ms:nowMs+1},{expires_at_ms:nowMs+300001},{extra:true}])expect(()=>verify(args(patch))).toThrow();
 });
 it('rejects wrong signature and independent key/digest pins',()=>{
  const a=args();expect(()=>verify({...a,signature:Buffer.alloc(64)})).toThrow();
  for(const k of ['payloadSha256','signerSpkiSha256'])expect(()=>verify({...a,expected:{...a.expected,[k]:'f'.repeat(64)}})).toThrow();
 });
});

describe('bounded resource artifact content contract',()=>{
 function artifactProof(doc){
  const artifact=Buffer.from(JSON.stringify(doc));
  const proof=args({artifact_sha256:sha(artifact)});
  proof.expected.artifactSha256=sha(artifact);
  return {artifact,proof};
 }
 const doc={schema:'aaditech-resource-diagnostic-v1',cpu_percent:0,ram_percent:75,disk_percent:null};
 it('verifies content bytes and counts measured fields without asserting truth',()=>{
  expect(verifyResourceDiagnosticArtifact(artifactProof(doc))).toMatchObject({artifact_content_verified:true,measurement_truth_verified:false,measured_fields:2,attempt_executed:false});
 });
 it('rejects extra private fields, invalid percentages and tampering',()=>{
  for(const patch of [{process:'private'},{cpu_percent:'0'},{ram_percent:101},{disk_percent:-1}])
   expect(()=>verifyResourceDiagnosticArtifact(artifactProof({...doc,...patch}))).toThrow();
  const a=artifactProof(doc);a.artifact[0]=0;expect(()=>verifyResourceDiagnosticArtifact(a)).toThrow();
 });
});
