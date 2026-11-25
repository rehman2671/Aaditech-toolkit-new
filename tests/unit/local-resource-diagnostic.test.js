import {describe,it,expect} from 'vitest';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {verifyResourceDiagnosticArtifact} from '../../diagnostic-evidence.js';
import {mkdtemp,realpath,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectLocalResourceDiagnostic as collect} from '../../scripts/local-resource-diagnostic.mjs';
const confirmation='COLLECT_LOCAL_RESOURCE_ONLY';
describe('local resource collector (no remote execution)',()=>{
 it('reads real OS counters into the bounded canonical artifact without writing files',async()=>{
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-resource-'));
  try{
   const result=await collect({confirmation,targetDirectory:dir,sampleMs:100});
   const doc=JSON.parse(result.artifact.toString('utf8'));
   expect(Object.keys(doc)).toEqual(['schema','cpu_percent','ram_percent','disk_percent']);
   expect(doc.schema).toBe('aaditech-resource-diagnostic-v1');
   const fields=[doc.cpu_percent,doc.ram_percent,doc.disk_percent];
   expect(fields.every(v=>v===null||(typeof v==='number'&&v>=0&&v<=100))).toBe(true);
   expect(result.measured_fields).toBe(fields.filter(v=>v!==null).length);
   if(process.platform==='linux'){expect(doc.disk_percent).not.toBeNull();expect(doc.ram_percent).not.toBeNull();}
   expect(result.artifact_sha256).toBe(createHash('sha256').update(result.artifact).digest('hex'));
   expect(result).toMatchObject({collection_scope:'LOCAL_OPERATOR_REFERENCE',measurement_truth_verified:false,
    remote_execution_authorized:false,production_accepted:false});
   expect(result.artifact.toString()).not.toContain(dir);
   expect(await readdir(dir)).toEqual([]);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
 it('requires explicit local confirmation, absolute path and bounded sampling window',async()=>{
  const targetDirectory=await realpath(tmpdir());
  for(const input of [{targetDirectory},{confirmation,targetDirectory:'relative'},
    {confirmation,targetDirectory,sampleMs:99},{confirmation,targetDirectory,sampleMs:2001},
    {confirmation,targetDirectory,sampleMs:'100'}])
   await expect(collect(input)).rejects.toThrow('EXPLICIT_LOCAL_RESOURCE_POLICY_REQUIRED');
 });
 it('reports missing filesystem observation as null rather than fabricated zero',async()=>{
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-resource-'));
  try{
   const result=await collect({confirmation,targetDirectory:join(dir,'missing'),sampleMs:100});
   expect(JSON.parse(result.artifact).disk_percent).toBeNull();
  }finally{await rm(dir,{recursive:true,force:true})}
 });
});

it('passes collected canonical bytes into the independent signed review verifier',async()=>{
 const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-resource-'));
 try{
  const result=await collect({confirmation,targetDirectory:dir,sampleMs:100});
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const sha=b=>createHash('sha256').update(b).digest('hex');
  const nowMs=Date.now(),expected={installationId:randomUUID(),tenantId:randomUUID(),
   deviceId:randomUUID(),incidentId:randomUUID(),planId:randomUUID(),
   diagnosticId:'RESOURCE_PRESSURE',credentialFingerprint:'a'.repeat(64),challengeSha256:'b'.repeat(64),
   artifactSha256:result.artifact_sha256,signerSpkiSha256:sha(publicKey.export({type:'spki',format:'der'}))};
  const payload=Buffer.from(JSON.stringify({schema:'aaditech-diagnostic-evidence-v1',
   purpose:'REVIEW_ONLY_DIAGNOSTIC_ARTIFACT',installation_id:expected.installationId,tenant_id:expected.tenantId,
   device_id:expected.deviceId,incident_id:expected.incidentId,plan_id:expected.planId,diagnostic_id:expected.diagnosticId,
   credential_fingerprint:expected.credentialFingerprint,challenge_sha256:expected.challengeSha256,
   artifact_sha256:expected.artifactSha256,issued_at_ms:nowMs,expires_at_ms:nowMs+1000}));
  expected.payloadSha256=sha(payload);
  const verified=verifyResourceDiagnosticArtifact({artifact:result.artifact,proof:{payload,
   signature:sign(null,payload,privateKey),publicKeyPem:publicKey.export({type:'spki',format:'pem'}),expected,nowMs}});
  expect(verified).toMatchObject({artifact_content_verified:true,measured_fields:result.measured_fields,
   measurement_truth_verified:false,attempt_executed:false,diagnostic_authorized:false,production_accepted:false});
 }finally{await rm(dir,{recursive:true,force:true})}
});
