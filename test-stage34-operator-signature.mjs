#!/usr/bin/env node
// Synthetic N34 crypto/provenance acceptance; test key generated IN MEMORY
// on disposable CI only, never copied to production or used for public signing.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sha256} from './Enterprise/deploy/stage33-receipt-core.mjs';
import {publicKeyPin,signAttestation} from './Enterprise/deploy/stage34-attestation-core.mjs';
import {signRegistry,verifyRegistry,verifyActiveOperatorEvidence} from './Enterprise/deploy/stage35-operator-registry-core.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'n34-ci-'));
const cli=path.resolve('Enterprise/deploy/stage34-operator-signature.mjs');
const bundler=path.resolve('Enterprise/tests/New-Stage32CustomerEvidenceBundle.ps1');
const file=(name)=>path.join(root,name);
const put=(f,o,mode=0o600)=>fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n',{mode});
const run=(mode,overrides={})=>{
  const args=['--offline',file('stage32-offline.json'),'--recovered',file('stage32-recovered.json'),
    '--receipt',file('stage33-server-receipt.json')];
  if(mode==='sign'){
    args.push('--private-key',file('private.pem'),'--output',file('stage34-attestation.json'));
  } else {
    args.push('--attestation',file('stage34-attestation.json'),
      '--trusted-public-key',overrides.key || file('trusted-public.pem'),
      '--approved-spki-sha256',overrides.pin || pin);
  }
  return spawnSync(process.execPath,[cli,mode,...args],{encoding:'utf8',timeout:10000});
};
const blocked=(result,label)=>{
  assert.equal(result.status,1,label+' should fail closed: '+result.stderr);
  assert.match(result.stderr,/N(?:34|35) BLOCKED/);
  assert(!result.stderr.includes('PRIVATE KEY'));
};
const bundle=(out,extra=[])=>spawnSync('pwsh',['-NoProfile','-File',bundler,
  '-EvidenceDirectory',root,'-BundlePath',file(out),
  '-ServerReceiptReport',file('stage33-server-receipt.json'),...extra
],{encoding:'utf8',timeout:20000});
let pin;
try {
  const keys=crypto.generateKeyPairSync('ed25519');
  const other=crypto.generateKeyPairSync('ed25519');
  pin=publicKeyPin(keys.publicKey);
  fs.writeFileSync(file('private.pem'),keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
  fs.writeFileSync(file('trusted-public.pem'),keys.publicKey.export({format:'pem',type:'spki'}),{mode:0o600});
  fs.writeFileSync(file('other-public.pem'),other.publicKey.export({format:'pem',type:'spki'}),{mode:0o600});
  const offline={
    schema:'aaditech-stage32-offline-v1',phase:'OFFLINE_OPERATOR_ATTESTED',
    run_id:'a'.repeat(32),batch_id:'b'.repeat(32),in_flight_events:1,
    captured_utc:'2026-11-18T03:20:21.0000000Z',payload_sha256:'c'.repeat(64),
    event_ids_sha256:'d'.repeat(64),queue_identity_sha256:'e'.repeat(64),
    certified_for_production:false,network_interruption_independently_measured:false,
    server_receipt_independently_verified:false
  };
  put(file('stage32-offline.json'),offline);
  const recovered={
    schema:'aaditech-stage32-recovered-v1',phase:'LOCAL_SQLITE_ACK_OBSERVED',
    run_id:offline.run_id,batch_id:offline.batch_id,
    captured_utc:'2026-11-18T03:21:21.0000000Z',payload_sha256:offline.payload_sha256,
    queue_identity_sha256:offline.queue_identity_sha256,
    offline_evidence_sha256:sha256(fs.readFileSync(file('stage32-offline.json'))),
    delivered_event_count:1,local_ack_observed:true,
    certified_for_production:false,network_interruption_independently_measured:false,
    server_receipt_independently_verified:false
  };
  put(file('stage32-recovered.json'),recovered);
  const receipt={
    schema:'aaditech-stage33-server-receipt-v1',
    run_id:offline.run_id,batch_id:offline.batch_id,
    offline_evidence_sha256:sha256(fs.readFileSync(file('stage32-offline.json'))),
    recovered_evidence_sha256:sha256(fs.readFileSync(file('stage32-recovered.json'))),
    local_payload_sha256:offline.payload_sha256,
    scoped_owner_fingerprint_sha256:'f'.repeat(64),
    server_request_hash_fingerprint_sha256:'1'.repeat(64),
    receipt_count:1,accepted_count:1,recorded_at_database_utc:'2026-11-18T03:21:21.000000Z',
    scoped_mysql_receipt_verified:true,raw_http_json_hash_matched:false,
    report_authenticated_to_operator:false,network_partition_independently_measured:false,
    production_certified:false
  };
  put(file('stage33-server-receipt.json'),receipt);
  const signed=run('sign');
  assert.equal(signed.status,0,'ephemeral CI Ed25519 signing: '+signed.stderr);
  const attestation=JSON.parse(fs.readFileSync(file('stage34-attestation.json'),'utf8'));
  assert.equal(attestation.public_key_spki_sha256,pin);
  assert.equal(attestation.payload.customer_production_certified,false);
  const originalVerification=run('verify');
  assert.equal(originalVerification.status,0,'pinned key must verify: '+originalVerification.stderr.trim());
  blocked(run('verify',{key:file('other-public.pem')}),'substituted trusted key');
  blocked(run('verify',{pin:'2'.repeat(64)}),'unapproved independent pin');
  blocked(run('sign'),'immutable attestation overwrite');
  const orig=fs.readFileSync(file('stage34-attestation.json'));
  assert.deepEqual(fs.readFileSync(file('stage34-attestation.json')),orig);

  const signArgs=['-OperatorAttestationFile',file('stage34-attestation.json'),
    '-TrustedOperatorPublicKeyFile',file('trusted-public.pem'),
    '-ApprovedOperatorKeySha256',pin];
  if(process.platform==='win32'){
    const good=bundle('stage34-bundle.json',signArgs);
    assert.equal(good.status,0,'real Windows PowerShell bundler must accept pinned Ed25519 signature: '+good.stderr);
    const result=JSON.parse(fs.readFileSync(file('stage34-bundle.json'),'utf8'));
    assert.equal(result.pinned_operator_signature_verified,true);
    assert.equal(result.server_report_source_authenticated,false);
    assert.equal(result.production_certified,false);
    assert.equal(result.human_operator_signoff,'PENDING');
    assert.equal(result.artifacts.length,4,'2 N32, N33 receipt, N34 signature');
    const missing=bundle('missing-pin.json',signArgs.slice(0,-2));
    assert.notEqual(missing.status,0,'bundler must reject missing approved key pin');
    assert(!fs.existsSync(file('missing-pin.json')));
    const wrong=bundle('wrong-pin.json',signArgs.slice(0,-1).concat('3'.repeat(64)));
    assert.notEqual(wrong.status,0,'bundler rejects wrong operator pin');
    assert(!fs.existsSync(file('wrong-pin.json')));
  }

  // N35: synthetic, independent ROOT authority key; it never enters any
  // public release. Two approval pins (root and exact registry bytes) are
  // supplied out-of-band by this isolated test fixture.
  const rootAuthority=crypto.generateKeyPairSync('ed25519');
  const nextOperator=crypto.generateKeyPairSync('ed25519');
  const rootPin=publicKeyPin(rootAuthority.publicKey);
  const timestamp=new Date().toISOString();
  const from=new Date(Date.now()-86400000).toISOString();
  const until=new Date(Date.now()+20*86400000).toISOString();
  const rootPrivate=file('stage35-root-private.pem');
  const rootPublic=file('stage35-root-public.pem');
  fs.writeFileSync(rootPrivate,rootAuthority.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  fs.writeFileSync(rootPublic,rootAuthority.publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
  const keyInfo=(key,keyId,state='ACTIVE')=>({
    key_id:keyId,
    public_key_spki_base64:key.export({type:'spki',format:'der'}).toString('base64'),
    public_key_spki_sha256:publicKeyPin(key),
    state,purpose:'SCOPED_MYSQL_RECEIPT_REVIEW',
    valid_from_utc:from,valid_until_utc:until,
    revoked_at_utc:state==='REVOKED'?timestamp:null
  });
  const draft={
    schema:'aaditech-stage35-operator-key-registry-payload-v1',
    revision:10,issued_at_utc:timestamp,
    expires_at_utc:new Date(Date.now()+2*86400000).toISOString(),
    keys:[keyInfo(keys.publicKey,'ops-primary-2026')]
  };
  const issueRegistry=file('stage35-issue-draft.json');
  put(issueRegistry,draft);
  const issuedPath=file('stage35-registry.json');
  const issued=spawnSync(process.execPath,[
    path.resolve('Enterprise/deploy/stage35-key-registry.mjs'),'issue',
    '--draft',issueRegistry,'--authority-private-key',rootPrivate,
    '--output',issuedPath
  ],{encoding:'utf8',timeout:10000});
  assert.equal(issued.status,0,'N35 offline issue denied: '+issued.stderr);
  const registryBytes=fs.readFileSync(issuedPath);
  const registryHash=sha256(registryBytes);
  const parsedRegistry=JSON.parse(registryBytes.toString('utf8'));
  assert.equal(parsedRegistry.authority_spki_sha256,rootPin);
  const approved=verifyRegistry(registryBytes,rootAuthority.publicKey,rootPin,registryHash,10);
  const input={offline,recovered,receipt,
    offlineBytes:fs.readFileSync(file('stage32-offline.json')),
    recoveredBytes:fs.readFileSync(file('stage32-recovered.json')),
    receiptBytes:fs.readFileSync(file('stage33-server-receipt.json'))};
  const n35Verified=verifyActiveOperatorEvidence(input,attestation,approved);
  assert.equal(n35Verified.n34_signature_verified,true);
  assert.equal(n35Verified.production_certified,false);
  assert.equal(n35Verified.operator_legal_authorization_independently_pending,true);
  const keyRegistryCli=path.resolve('Enterprise/deploy/stage35-key-registry.mjs');
  const n35Args=(registryFile,registryDigest,revision,attestationFile=file('stage34-attestation.json'))=>[
    '--registry',registryFile,'--authority-public-key',rootPublic,
    '--approved-root-spki-sha256',rootPin,
    '--approved-registry-sha256',registryDigest,
    '--approved-revision',String(revision),
    '--offline',file('stage32-offline.json'),'--recovered',file('stage32-recovered.json'),
    '--receipt',file('stage33-server-receipt.json'),'--attestation',attestationFile
  ];
  const n35Check=(regPath=issuedPath,hash=registryHash,rev=10,attestPath)=>spawnSync(process.execPath,
    [keyRegistryCli,'check',...n35Args(regPath,hash,rev,attestPath)],{encoding:'utf8',timeout:10000});
  assert.equal(n35Check().status,0,'approved N35 active operator evidence should verify');
  blocked(n35Check(issuedPath,registryHash,9),'old/unapproved registry revision');
  blocked(n35Check(issuedPath,'2'.repeat(64),10),'unapproved registry file SHA256');
  const fakeRoot=crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(file('stage35-other-root.pem'),fakeRoot.publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
  const badRoot=spawnSync(process.execPath,[keyRegistryCli,'check',
    ...n35Args(issuedPath,registryHash,10).map((x,i,a)=>a[i-1]==='--authority-public-key'?file('stage35-other-root.pem'):x)
  ],{encoding:'utf8',timeout:10000});
  blocked(badRoot,'substituted registry authority');
  const registryArgs=[
    '-OperatorKeyRegistryFile',issuedPath,
    '-RegistryAuthorityPublicKeyFile',rootPublic,
    '-ApprovedRegistryAuthorityPin',rootPin,
    '-ApprovedOperatorRegistrySha256',registryHash,
    '-ApprovedOperatorRegistryRevision','10'
  ];
  if(process.platform==='win32'){
    const good35=bundle('stage35-bundle.json',[...signArgs,...registryArgs]);
    assert.equal(good35.status,0,'N35 approved key registry Windows bundle: '+good35.stderr);
    const verifiedBundle=JSON.parse(fs.readFileSync(file('stage35-bundle.json'),'utf8'));
    assert.equal(verifiedBundle.operator_key_lifecycle_verified,true);
    assert.equal(verifiedBundle.operator_registry_revision,10);
    assert.equal(verifiedBundle.operator_registry_sha256,registryHash);
    assert.equal(verifiedBundle.production_certified,false);
    assert.equal(verifiedBundle.server_report_source_authenticated,false);
    assert.equal(verifiedBundle.human_operator_signoff,'PENDING');
    assert.equal(verifiedBundle.artifacts.length,5);
    const wrong35=bundle('stage35-unapproved-revision.json',
      [...signArgs,...registryArgs.slice(0,-1),'9']);
    assert.notEqual(wrong35.status,0,'N35 must reject incorrect approved version');
    assert(!fs.existsSync(file('stage35-unapproved-revision.json')));
    const partial35=bundle('stage35-missing-pin.json',
      [...signArgs,...registryArgs.slice(0,-4)]);
    assert.notEqual(partial35.status,0,'N35 must reject incomplete independent registry approval');
    assert(!fs.existsSync(file('stage35-missing-pin.json')));
  }
  // Root signature + exact SHA match cannot restore a revoked key.
  const revoked={...draft,revision:11,keys:[keyInfo(keys.publicKey,'ops-primary-2026','REVOKED')]};
  const revokedPath=file('stage35-revoked.json');
  put(revokedPath,signRegistry(revoked,rootAuthority.privateKey));
  const revokedHash=sha256(fs.readFileSync(revokedPath));
  blocked(n35Check(revokedPath,revokedHash,11),'current registry revokes old signer');
  // Key rotation: old signer remains revoked, successor becomes ACTIVE.
  const rotation={...draft,revision:12,keys:[
    keyInfo(nextOperator.publicKey,'ops-next-2026'),
    keyInfo(keys.publicKey,'ops-primary-2026','REVOKED')
  ]};
  const rotationPath=file('stage35-rotated.json');
  put(rotationPath,signRegistry(rotation,rootAuthority.privateKey));
  const rotationHash=sha256(fs.readFileSync(rotationPath));
  blocked(n35Check(rotationPath,rotationHash,12),'rotated registry must reject old key');
  const successor=signAttestation(input,nextOperator.privateKey);
  const successorPath=file('stage34-next-operator.json');
  put(successorPath,successor);
  const successorCheck=n35Check(rotationPath,rotationHash,12,successorPath);
  assert.equal(successorCheck.status,0,'new active key after rotation must verify: '+successorCheck.stderr);
  blocked(n35Check(issuedPath,registryHash,12),'old registry cannot be replayed as latest approved revision');
  const registryNow=verifyRegistry(fs.readFileSync(rotationPath),rootAuthority.publicKey,rootPin,rotationHash,12);
  const rotated=verifyActiveOperatorEvidence(input,successor,registryNow);
  assert.equal(rotated.operator_key_id,'ops-next-2026');

  const modified={...receipt,accepted_count:0};
  put(file('stage33-server-receipt.json'),modified);
  blocked(run('verify'),'modified server receipt count');
  if(process.platform==='win32'){
    const bad=bundle('tampered-bundle.json',signArgs);
    assert.notEqual(bad.status,0,'bundler cannot certify changed server report');
    assert(!fs.existsSync(file('tampered-bundle.json')));
  }
  put(file('stage33-server-receipt.json'),receipt);
  const mutated={...attestation,payload:{...attestation.payload,customer_production_certified:true}};
  put(file('stage34-attestation.json'),mutated);
  blocked(run('verify'),'forged production claim in signed payload');
  console.log('N34/N35 PASS: CI-only Ed25519 signing, signed/revoked/rotated registry, independent hash/revision approval, tampering/overwrite denial'+
    (process.platform==='win32'?' and PowerShell composite bundle verification':''));
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
