import {describe,it,expect} from 'vitest';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {mkdtemp,realpath,readdir,rm,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectLocalNetworkDiagnostic as network,collectLocalDiskDiagnostic as disk,collectLocalBatteryDiagnostic as battery,parseLinuxIPv4DefaultRoute as route} from '../../scripts/local-categorical-diagnostics.mjs';
import {verifyCategoricalDiagnosticArtifact} from '../../diagnostic-evidence.js';
const header='Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT';
const entry=(name,dest='00000000',flags='0003',mask='00000000')=>[name,dest,'0100000A',flags,0,0,0,mask,0,0,0].join(' ');
const sha=x=>createHash('sha256').update(x).digest('hex');
function verify(result,id){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519'),nowMs=Date.now();
 const expected={installationId:randomUUID(),tenantId:randomUUID(),deviceId:randomUUID(),incidentId:randomUUID(),planId:randomUUID(),
 diagnosticId:id,credentialFingerprint:'a'.repeat(64),challengeSha256:'b'.repeat(64),artifactSha256:result.artifact_sha256,
 signerSpkiSha256:sha(publicKey.export({type:'spki',format:'der'}))};
 const payload=Buffer.from(JSON.stringify({schema:'aaditech-diagnostic-evidence-v1',purpose:'REVIEW_ONLY_DIAGNOSTIC_ARTIFACT',
 installation_id:expected.installationId,tenant_id:expected.tenantId,device_id:expected.deviceId,incident_id:expected.incidentId,plan_id:expected.planId,
 diagnostic_id:id,credential_fingerprint:expected.credentialFingerprint,challenge_sha256:expected.challengeSha256,artifact_sha256:expected.artifactSha256,
 issued_at_ms:nowMs,expires_at_ms:nowMs+1000}));
 expected.payloadSha256=sha(payload);
 return verifyCategoricalDiagnosticArtifact({artifact:result.artifact,proof:{payload,signature:sign(null,payload,privateKey),
 publicKeyPem:publicKey.export({type:'spki',format:'pem'}),expected,nowMs}});
}
describe('passive local categorical collectors',()=>{
 it('distinguishes a selected interface active IPv4 default route from absent or unknown',()=>{
  expect(route(header+'\n'+entry('eth0'),'eth0')).toBe('PRESENT');
  expect(route(header+'\n'+entry('eth0','00000000','0201'),'eth0')).toBe('ABSENT');
  expect(route(header+'\n'+entry('eth0','00000000','0000'),'eth0')).toBe('ABSENT');
  expect(route(header+'\n'+entry('eth0'),'eth1')).toBeNull();
  expect(route(header,'eth0')).toBeNull();
 });
 it('rejects malformed route tables even following a valid route',()=>{
  for(const text of ['wrong',header+'\n'+entry('eth0')+'\ninvalid',header+'\n'+entry('eth0','GGGGGGGG')])
   expect(()=>route(text,'eth0')).toThrow('ROUTE_TABLE_INVALID');
 });
 it('requires explicit local policy and rejects path-like interface input',async()=>{
  for(const input of [{interfaceId:'lo'},{confirmation:'COLLECT_LOCAL_NETWORK_ONLY',interfaceId:'../lo'},{confirmation:'COLLECT_LOCAL_NETWORK_ONLY',interfaceId:'lo\n'}])
   await expect(network(input)).rejects.toThrow('EXPLICIT_LOCAL_DIAGNOSTIC_POLICY_REQUIRED');
  await expect(disk({confirmation:'COLLECT_LOCAL_DISK_ONLY',targetDirectory:'relative'})).rejects.toThrow();
 });
 it('reads local Linux network state without probing or emitting identifiers',async()=>{
  const r=await network({confirmation:'COLLECT_LOCAL_NETWORK_ONLY',interfaceId:'lo'});
  const doc=JSON.parse(r.artifact);
  expect(Object.keys(doc)).toEqual(['schema','link_state','default_route_state','approved_probe_state']);
  expect(doc.approved_probe_state).toBe('NOT_RUN');expect(r.artifact_sha256).toBe(sha(r.artifact));
  expect(verify(r,'APPROVED_NETWORK_STATUS')).toMatchObject({artifact_content_verified:true,measured_fields:r.measured_fields,attempt_executed:false,production_accepted:false});
 });
 it('validates an actual local battery observation through the signed review contract',async()=>{
  const r=await battery({confirmation:'COLLECT_LOCAL_BATTERY_ONLY',batteryId:'BAT0'});
  expect(verify(r,'BATTERY_HEALTH')).toMatchObject({artifact_content_verified:true,measured_fields:r.measured_fields,measurement_truth_verified:false,attempt_executed:false});
 });
 it('measures available filesystem capacity and never infers SMART health or writability',async()=>{
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-disk-'));
  try{
   const r=await disk({confirmation:'COLLECT_LOCAL_DISK_ONLY',targetDirectory:dir});
   const doc=JSON.parse(r.artifact);
   expect(doc).toMatchObject({schema:'aaditech-disk-diagnostic-v1',health_state:null,read_only_state:null});
   if(process.platform==='linux')expect(typeof doc.free_percent).toBe('number');
   if(doc.free_percent!==null)expect(doc.free_percent>=0&&doc.free_percent<=100).toBe(true);
   expect(verify(r,'DISK_CAPACITY_HEALTH')).toMatchObject({artifact_content_verified:true,measured_fields:r.measured_fields,measurement_truth_verified:false});
   expect(r.artifact.toString()).not.toContain(dir);expect(await readdir(dir)).toEqual([]);
   const missing=await disk({confirmation:'COLLECT_LOCAL_DISK_ONLY',targetDirectory:join(dir,'missing')});
   expect(JSON.parse(missing.artifact).free_percent).toBeNull();expect(missing.measured_fields).toBe(0);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
});
