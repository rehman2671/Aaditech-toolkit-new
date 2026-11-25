// Local review bridge: retained artifact bytes + independently pinned proof.
// No key generation, collection, remote transport, attempt acceptance or
// claims of truth. Caller is a trusted local reviewer; CLI uses local clock.
import {readRetainedLocalDiagnosticArtifact} from './local-diagnostic-artifact-store.mjs';
import {verifyResourceDiagnosticArtifact,verifyCategoricalDiagnosticArtifact} from '../diagnostic-evidence.js';
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const fail=()=>{throw Error('RETAINED_DIAGNOSTIC_REVIEW_UNVERIFIED')};
const expectedKeys=['payloadSha256','signerSpkiSha256','installationId','tenantId','deviceId','incidentId','planId','diagnosticId','credentialFingerprint','challengeSha256','artifactSha256'];
export async function reviewRetainedDiagnosticArtifact(input){
 if(!exact(input,['confirmation','directory','payloadBase64','signatureBase64','publicKeyPem','expected'])||input.confirmation!=='REVIEW_RETAINED_DIAGNOSTIC_ONLY'||!exact(input.expected,expectedKeys))fail();
 const b64=(x,max)=>{if(typeof x!=='string'||x.length>Math.ceil(max/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(x))fail();const b=Buffer.from(x,'base64');if(!b.length||b.length>max||b.toString('base64')!==x)fail();return b};
 const payload=b64(input.payloadBase64,4096),signature=b64(input.signatureBase64,64);
 if(signature.length!==64)fail();
 const expected=Object.freeze({...input.expected});
 const local=await readRetainedLocalDiagnosticArtifact({confirmation:'READ_LOCAL_DIAGNOSTIC_ONLY',directory:input.directory,expectedArtifactSha256:expected.artifactSha256});
 const verifier=expected.diagnosticId==='RESOURCE_PRESSURE'?verifyResourceDiagnosticArtifact:verifyCategoricalDiagnosticArtifact;
 const result=verifier({artifact:local.artifact,proof:{payload,signature,publicKeyPem:input.publicKeyPem,expected,nowMs:Date.now()}});
 if(result.signature_and_binding_verified!==true||result.artifact_content_verified!==true)fail();
 return Object.freeze({diagnostic_id:expected.diagnosticId,artifact_sha256:expected.artifactSha256,payload_sha256:expected.payloadSha256,
  retained_integrity_verified:true,signature_and_binding_verified:true,artifact_content_verified:true,measured_fields:result.measured_fields,
  trusted_clock_verified:false,independent_key_custody_verified:false,replay_consumed:false,measurement_truth_verified:false,
  attempt_accepted:false,execution_authorized:false,repair_authorized:false,verified_resolved:false,production_accepted:false});
}
