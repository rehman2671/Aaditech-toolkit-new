import {describe,it,expect} from 'vitest';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {additionalDiagnosticReviewContracts as contracts} from '../../diagnostic-review-contracts.js';
import {verifyCategoricalDiagnosticArtifact} from '../../diagnostic-evidence.js';
import {inspectDiagnosticCapability,summarizeDiagnosticCapabilities} from '../../diagnostic-capability-catalog.js';
import {troubleshootingCatalog} from '../../troubleshooting-policy.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const samples={
 UPDATE_STATUS:{update_state:'FAILED',restart_state:'REQUIRED'},
 AUDIO_STATUS:{output_state:'AVAILABLE',mute_state:'MUTED'},
 BLUETOOTH_STATUS:{radio_state:'ON',service_state:'RUNNING'},
 PRINT_STATUS:{queue_state:'PENDING',service_state:'RUNNING'},
 BOOT_TIMING:{boot_duration_ms:0,startup_duration_ms:1234},
 APPLICATION_HEALTH:{application_state:'FAILED',crash_count:0},
 SHELL_STATUS:{shell_state:'RESPONDING'},
 BATTERY_HEALTH:{charge_percent:75.5,charging_state:'CHARGING',capacity_percent:80},
 MANAGED_POLICY_STATUS:{ownership_state:'MANAGED',configuration_state:'CONFIGURED'},
 APPROVED_SOFTWARE_INVENTORY:{approved_count:0,unclassified_count:12},
 OS_SHELL_CONFIGURATION:{configuration_state:'DEFAULT',ownership_state:'UNMANAGED'},
 POWER_PLAN_STATUS:{power_mode:'BALANCED',sleep_policy_state:'CONFIGURED'},
 FIREWALL_STATUS:{domain_profile:'ENABLED',private_profile:'DISABLED',public_profile:'ENABLED'}
};
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
function proof(artifact,id){
 const nowMs=Date.now(),expected={installationId:randomUUID(),tenantId:randomUUID(),deviceId:randomUUID(),incidentId:randomUUID(),planId:randomUUID(),
 diagnosticId:id,credentialFingerprint:'a'.repeat(64),challengeSha256:'b'.repeat(64),artifactSha256:sha(artifact),
 signerSpkiSha256:sha(publicKey.export({type:'spki',format:'der'}))};
 const payload=Buffer.from(JSON.stringify({schema:'aaditech-diagnostic-evidence-v1',purpose:'REVIEW_ONLY_DIAGNOSTIC_ARTIFACT',
 installation_id:expected.installationId,tenant_id:expected.tenantId,device_id:expected.deviceId,incident_id:expected.incidentId,plan_id:expected.planId,
 diagnostic_id:id,credential_fingerprint:expected.credentialFingerprint,challenge_sha256:expected.challengeSha256,
 artifact_sha256:expected.artifactSha256,issued_at_ms:nowMs,expires_at_ms:nowMs+1000}));
 expected.payloadSha256=sha(payload);
 return {artifact,proof:{payload,signature:sign(null,payload,privateKey),publicKeyPem:publicKey.export({type:'spki',format:'pem'}),expected,nowMs}};
}
describe('13 additional signed categorical review formats',()=>{
 for(const [id,sample] of Object.entries(samples)){
  const doc={schema:contracts[id].schema,...sample};
  const bytes=()=>Buffer.from(JSON.stringify(doc));
  const first=Object.keys(sample)[0];
  const check=d=>verifyCategoricalDiagnosticArtifact(proof(Buffer.from(JSON.stringify(d)),id));
  it(id+' verifies signed exact bounded observations only',()=>{
   expect(verifyCategoricalDiagnosticArtifact(proof(bytes(),id))).toMatchObject({artifact_content_verified:true,
    measured_fields:Object.keys(sample).length,measurement_truth_verified:false,attempt_executed:false,
    diagnostic_authorized:false,repair_authorized:false,verified_resolved:false,production_accepted:false});
  });
  it(id+' allows explicitly unavailable observations without claiming measurement',()=>{
   expect(check({schema:doc.schema,...Object.fromEntries(Object.keys(sample).map(k=>[k,null]))}).measured_fields).toBe(0);
  });
  it(id+' rejects additional private fields',()=>expect(()=>check({...doc,private_content:'secret'})).toThrow());
  it(id+' rejects coercible or malformed observations',()=>{
   for(const v of [true,{},[], 'arbitrary private text',-1])expect(()=>check({...doc,[first]:v})).toThrow();
  });
  it(id+' rejects wrong schema and omitted fields',()=>{
   expect(()=>check({...doc,schema:'unapproved'})).toThrow();
   const missing={...doc};delete missing[first];expect(()=>check(missing)).toThrow();
  });
  it(id+' refuses tampering and noncanonical serialization',()=>{
   const p=proof(bytes(),id);p.artifact[0]=0;expect(()=>verifyCategoricalDiagnosticArtifact(p)).toThrow();
   expect(()=>verifyCategoricalDiagnosticArtifact(proof(Buffer.from(JSON.stringify(doc,null,2)),id))).toThrow();
  });
 }
});
describe('capability matrix',()=>{
 it('covers every distinct diagnostic and original issue on three OS profiles',()=>{
  const r=summarizeDiagnosticCapabilities();
  expect(r.categories).toHaveLength(3);
  for(const os of r.categories){
   expect(os.categories.map(x=>x.category_id)).toEqual(troubleshootingCatalog.map(x=>x.id));
   for(const c of os.categories){
    expect(c).toMatchObject({platform_verified:false,remote_collector_available:false,diagnostic_authorized:false,execution_authorized:false,repair_authorized:false,production_accepted:false});
    if(c.diagnostic_id===null)expect(c.availability).toBe('HUMAN_ONLY');
    else expect(typeof c.artifact_schema).toBe('string');
   }
  }
 });
 it('distinguishes review contract support from collector availability',()=>{
  expect(inspectDiagnosticCapability({categoryId:'TR-26',platform:'windows'})).toMatchObject({availability:'NOT_IMPLEMENTED',artifact_schema:'aaditech-firewall-diagnostic-v1'});
  expect(inspectDiagnosticCapability({categoryId:'TR-02',platform:'linux'}).availability).toBe('LINUX_PASSIVE_REFERENCE');
  expect(inspectDiagnosticCapability({categoryId:'TR-02',platform:'windows'}).availability).toBe('NOT_IMPLEMENTED');
 });
 it('rejects unknown issue and platform',()=>{
  expect(()=>inspectDiagnosticCapability({categoryId:'TR-99',platform:'windows'})).toThrow();
  expect(()=>inspectDiagnosticCapability({categoryId:'TR-01',platform:'unknown'})).toThrow();
 });
});
