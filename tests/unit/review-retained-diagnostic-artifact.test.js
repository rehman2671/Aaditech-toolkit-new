import {it,expect} from 'vitest';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {retainLocalDiagnosticArtifact} from '../../scripts/local-diagnostic-artifact-store.mjs';
import {reviewRetainedDiagnosticArtifact} from '../../scripts/review-retained-diagnostic-artifact.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
it.skipIf(process.platform!=='linux')('reviews retained canonical artifact against separately supplied signed proof and pins, never accepts attempt',async()=>{
 const directory=await mkdtemp(join(await realpath(tmpdir()),'retained-review-'));
 try{
  const artifact=Buffer.from(JSON.stringify({schema:'aaditech-resource-diagnostic-v1',cpu_percent:80,ram_percent:null,disk_percent:20}));
  const key=generateKeyPairSync('ed25519'),now=Date.now();
  const expected={installationId:id(1),tenantId:id(2),deviceId:id(3),incidentId:id(4),planId:id(5),diagnosticId:'RESOURCE_PRESSURE',credentialFingerprint:'a'.repeat(64),challengeSha256:'b'.repeat(64),artifactSha256:sha(artifact),signerSpkiSha256:sha(key.publicKey.export({type:'spki',format:'der'}))};
  const payload=Buffer.from(JSON.stringify({schema:'aaditech-diagnostic-evidence-v1',purpose:'REVIEW_ONLY_DIAGNOSTIC_ARTIFACT',installation_id:expected.installationId,tenant_id:expected.tenantId,device_id:expected.deviceId,incident_id:expected.incidentId,plan_id:expected.planId,diagnostic_id:expected.diagnosticId,credential_fingerprint:expected.credentialFingerprint,challenge_sha256:expected.challengeSha256,artifact_sha256:expected.artifactSha256,issued_at_ms:now-1000,expires_at_ms:now+60000}));
  expected.payloadSha256=sha(payload);
  await retainLocalDiagnosticArtifact({confirmation:'RETAIN_LOCAL_DIAGNOSTIC_ONLY',directory,artifact,expectedArtifactSha256:expected.artifactSha256});
  const input={confirmation:'REVIEW_RETAINED_DIAGNOSTIC_ONLY',directory,payloadBase64:payload.toString('base64'),signatureBase64:sign(null,payload,key.privateKey).toString('base64'),publicKeyPem:key.publicKey.export({type:'spki',format:'pem'}),expected};
  const r=await reviewRetainedDiagnosticArtifact(input);
  expect(r).toMatchObject({signature_and_binding_verified:true,artifact_content_verified:true,measured_fields:2,attempt_accepted:false,replay_consumed:false,verified_resolved:false});
  expect(r).not.toHaveProperty('artifact');
  for(const patch of [{expected:{...expected,deviceId:id(9)}},{expected:{...expected,signerSpkiSha256:'c'.repeat(64)}},{signatureBase64:Buffer.alloc(64).toString('base64')},{expected:{...expected,artifactSha256:'d'.repeat(64)}}])await expect(reviewRetainedDiagnosticArtifact({...input,...patch})).rejects.toThrow();
 }finally{await rm(directory,{recursive:true,force:true})}
});
