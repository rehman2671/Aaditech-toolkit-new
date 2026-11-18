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
import {publicKeyPin} from './Enterprise/deploy/stage34-attestation-core.mjs';

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
  assert.match(result.stderr,/N34 BLOCKED/);
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
  console.log('N34 PASS: CI-only Ed25519 signing, independent key pin, tampering/overwrite denial'+
    (process.platform==='win32'?' and PowerShell composite bundle verification':''));
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
