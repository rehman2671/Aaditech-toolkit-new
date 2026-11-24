import {describe,it,expect} from 'vitest';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectLocalLanReadiness} from '../../scripts/lan-combined-preflight.mjs';
import {verifySignedLanBundle} from '../../scripts/verify-lan-bundle.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'itk-signed-lan-'));
  try {
    const root=join(dir,'payload');await mkdir(root);
    const item=join(root,'image.tar'), bytes=Buffer.from('synthetic offline payload');
    await writeFile(item,bytes);
    const key=generateKeyPairSync('ed25519');
    const manifest=join(dir,'manifest.json'),signature=join(dir,'manifest.sig');
    const doc={schema_version:1,installation_mode:'intranet',files:[{path:'image.tar',size:bytes.length,sha256:sha(bytes)}]};
    const input={manifest,signature,root,
      trustedPublicKeyPem:key.publicKey.export({type:'spki',format:'pem'}),
      trustedSignerSpkiSha256:sha(key.publicKey.export({type:'spki',format:'der'}))};
    const publish=async content=>{
      await writeFile(manifest,content);
      await writeFile(signature,sign(null,content,key.privateKey));
      input.trustedManifestSha256=sha(content);
    };
    await publish(Buffer.from(JSON.stringify(doc)));
    await run({input,doc,item,bytes,publish});
  } finally {await rm(dir,{recursive:true,force:true})}
}
describe('signed LAN release manifest preflight',()=>{
  it('requires both approved digest and independent publisher pin; never authorizes install',()=>fixture(async({input})=>{
    const result=await verifySignedLanBundle(input);
    expect(result).toMatchObject({verified:true,files:1,publisher_signature_verified:true,
      payload_integrity_verified:true,installation_authorized:false,host_runtime_verified:false,
      offline_execution_verified:false});
    await expect(verifySignedLanBundle({...input,trustedSignerSpkiSha256:'0'.repeat(64)})).rejects.toThrow('Publisher signer pin mismatch');
    await expect(verifySignedLanBundle({...input,trustedManifestSha256:'0'.repeat(64)})).rejects.toThrow('Manifest not independently approved');
    await expect(verifySignedLanBundle({...input,trustedManifestSha256:undefined})).rejects.toThrow('Independently approved manifest digest required');
  }));
  it('rejects a replaced signature, changed payload and extra files',()=>fixture(async({input,item,bytes})=>{
    const original=await readFile(input.signature);
    await writeFile(input.signature,Buffer.alloc(64));
    await expect(verifySignedLanBundle(input)).rejects.toThrow('Publisher manifest signature invalid');
    await writeFile(input.signature,original);
    const bad=Buffer.from(bytes);bad[0]^=1;await writeFile(item,bad);
    await expect(verifySignedLanBundle(input)).rejects.toThrow('Payload SHA-256 mismatch');
    await writeFile(item,bytes);
    await writeFile(join(input.root,'extra.txt'),'unapproved');
    await expect(verifySignedLanBundle(input)).rejects.toThrow('Unexpected unmanifested payload file');
  }));
  it('rejects duplicate keys and excessive nesting even when signed and pinned',()=>fixture(async({input,doc,publish})=>{
    await publish(Buffer.from(JSON.stringify(doc).replace('"schema_version":1','"schema_version":1,"schema_version":1')));
    await expect(verifySignedLanBundle(input)).rejects.toThrow('Duplicate JSON object key');
    await publish(Buffer.from('{"x":'+'['.repeat(65)+'0'+']'.repeat(65)+'}'));
    await expect(verifySignedLanBundle(input)).rejects.toThrow('Manifest JSON nesting limit exceeded');
  }));
  it('rejects a detached signature stored inside the payload tree',()=>fixture(async({input})=>{
    const inside=join(input.root,'manifest.sig');
    await writeFile(inside,await readFile(input.signature));
    await expect(verifySignedLanBundle({...input,signature:inside})).rejects.toThrow('Signature must be outside payload root');
  }));
});

describe('combined local LAN preflight',()=>{
 const confirmation='INSPECT_LOCAL_LAN_ONLY';
 const hostFor=input=>({targetDirectory:input.root,markerPaths:{
  database:join(input.root,'absent-db'),credentials:join(input.root,'image.tar'),
  service:join(input.root,'absent-svc')},ports:[443],minCpu:1,minMemoryBytes:1,minFreeBytes:1});
 it('combines real signed fixture verification and read-only host observations without authorizing install',()=>fixture(async({input})=>{
  const host=hostFor(input);
  const result=await inspectLocalLanReadiness({confirmation,bundle:input,host});
  expect(result).toMatchObject({decision:'BLOCKED',publisher_signature_verified:true,payload_integrity_verified:true,
   markers:{database:'NOT_OBSERVED',credentials:'PRESENT',service:'NOT_OBSERVED'},installation_authorized:false,
   runtime_compatibility_verified:false,private_tls_verified:false,resource_absence_verified:false,
   port_reservation_verified:false,production_accepted:false});
  expect(result.blocking).toContain('marker_credentials');
  expect(JSON.stringify(result)).not.toContain(input.root);
  expect(JSON.stringify(result)).not.toContain(input.trustedPublicKeyPem);
 }));
 it('rejects an invalid bundle before performing host checks',()=>fixture(async({input})=>{
  await expect(inspectLocalLanReadiness({confirmation,bundle:{...input,trustedSignerSpkiSha256:'0'.repeat(64)},host:{}})).rejects.toThrow('Publisher signer pin mismatch');
  await expect(inspectLocalLanReadiness({bundle:input,host:hostFor(input)})).rejects.toThrow('EXPLICIT_LOCAL_PREFLIGHT_REQUIRED');
 }));
 it('does not let subsequent caller changes alter the observed host policy',()=>fixture(async({input})=>{
  const host=hostFor(input);
  const pending=inspectLocalLanReadiness({confirmation,bundle:input,host});
  host.markerPaths.credentials=join(input.root,'absent-creds');host.ports.push(443);
  const result=await pending;
  expect(result.markers.credentials).toBe('PRESENT');
  expect(result.ports).toHaveLength(1);
 }));
});

import {runLocalLanPreflightCli} from '../../scripts/local-lan-preflight-cli.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
describe('operator local LAN readiness CLI',()=>{
 const confirm=['--confirm-local-read-only'];
 const config=input=>({bundle:input,host:{targetDirectory:input.root,markerPaths:{
  database:join(input.root,'absent-db'),credentials:join(input.root,'image.tar'),service:join(input.root,'absent-svc')},
  ports:[443],minCpu:1,minMemoryBytes:1,minFreeBytes:1}});
 it('returns actual signed-bundle and host blocker report via JSON stdin',()=>fixture(async({input})=>{
  const bytes=Buffer.from(JSON.stringify(config(input)));
  const r=await runLocalLanPreflightCli(bytes,confirm);
  expect(r).toMatchObject({decision:'BLOCKED',installation_authorized:false,production_accepted:false});
  const script=fileURLToPath(new URL('../../scripts/local-lan-preflight-cli.mjs',import.meta.url));
  const child=spawnSync(process.execPath,[script,...confirm],{input:bytes,encoding:'utf8',timeout:10000});
  expect(child.status).toBe(2);expect(child.stderr).toBe('');
  expect(JSON.parse(child.stdout).blocking).toContain('marker_credentials');
  expect(child.stdout).not.toContain(input.root);
 }));
 it('rejects missing confirmation, extra configuration, relative paths and oversized inputs',()=>fixture(async({input})=>{
  const cfg=config(input),bytes=Buffer.from(JSON.stringify(cfg));
  await expect(runLocalLanPreflightCli(bytes,[])).rejects.toThrow('LOCAL_PREFLIGHT_INPUT_INVALID');
  for(const bad of [{...cfg,password:'private'},{...cfg,bundle:{...cfg.bundle,manifest:'relative'}}])
   await expect(runLocalLanPreflightCli(Buffer.from(JSON.stringify(bad)),confirm)).rejects.toThrow('LOCAL_PREFLIGHT_INPUT_INVALID');
  await expect(runLocalLanPreflightCli(Buffer.alloc(32769),confirm)).rejects.toThrow('LOCAL_PREFLIGHT_INPUT_INVALID');
 }));
});
