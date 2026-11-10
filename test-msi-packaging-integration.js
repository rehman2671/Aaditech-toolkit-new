import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isGenuineMsiArtifact,resolveAgentMsi} from './agent-artifacts.js';
const here=path.dirname(fileURLToPath(import.meta.url));

async function runTests() {
  console.log('=== MSI release gate integration tests ===');
  const BASE=process.env.BASE_URL||'http://127.0.0.1:3000';
  const meta=JSON.parse(fs.readFileSync(path.join(here,'Enterprise/agent/agent-version.json'),'utf8'));
  const version=meta.agent_version;
  assert.ok(/^\d+\.\d+\.\d+$/.test(version));

  // The shipped 1536-byte fixture is not a distributable MSI, even though
  // its first bytes imitate an OLE compound file header.
  const fixture=path.join(here,'Enterprise/agent/fixtures','IT-Toolkit-Agent-'+version+'.msi');
  if (fs.existsSync(fixture)) {
    assert.equal(isGenuineMsiArtifact(fixture),false,'Placeholder MSI must be rejected');
  }
  const available=resolveAgentMsi(version);
  if (process.env.NODE_ENV==='test') {
    assert.equal(available.found,false,'CI test checkout contains no genuine signed release MSI');
  }

  const bundle=await fetch(BASE+'/api/agent-bundle');
  assert.equal(bundle.status,200);
  const info=await bundle.json();
  assert.equal(info.agent_json.agent_version,version);
  assert.equal(info.msi_available,available.found);
  assert.equal(info.msi_size,available.found?available.size:0);
  assert.equal(info.msi_filename,'IT-Toolkit-Agent-'+version+'.msi');

  const ca=await fetch(BASE+'/api/ca.crt');
  assert.equal(ca.status,200);
  const caText=await ca.text();
  assert.match(caText,/-----BEGIN CERTIFICATE-----/);
  assert.match(caText,/-----END CERTIFICATE-----/);
  new crypto.X509Certificate(caText);

  const latest=await fetch(BASE+'/api/agent-msi');
  if (!available.found) {
    assert.equal(latest.status,404,'Do not stream a 1536-byte fixture');
    const body=await latest.json();
    assert.equal(body.msi_available,false);
  } else {
    assert.equal(latest.status,200);
    const bytes=Buffer.from(await latest.arrayBuffer());
    assert.ok(bytes.length>=65536);
    assert.equal(bytes.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
  }

  const adminToken=jwt.sign({
    id:1,username:'superadmin',role:'SUPER_ADMIN',
    tenant_id:'00000000-0000-0000-0000-000000000001',
    jti:crypto.randomUUID()
  },process.env.JWT_SECRET,{expiresIn:'1h'});
  const packageResult=await fetch(BASE+'/api/v1/msi/generate',{
    method:'POST',
    headers:{'Authorization':'Bearer '+adminToken,'Content-Type':'application/json'},
    body:JSON.stringify({
      package_name:'CI-MSI-Release-Gate-'+Date.now(),
      version,
      group_id:'ci-development'
    })
  });
  assert.equal(packageResult.status,201);
  const pkg=await packageResult.json();
  assert.ok(pkg.id&&pkg.bootstrap_token&&pkg.download_url);
  assert.equal(pkg.version,version);
  assert.equal(pkg.status,available.found?'READY':'PENDING',
    'No fake READY state for placeholder MSI');
  if(!available.found) {
    assert.equal(pkg.file_hash_sha256,null);
    assert.equal(pkg.file_size_bytes,0);
    const pendingDownload=await fetch(BASE+pkg.download_url);
    assert.equal(pendingDownload.status,404,'Pending/untrusted MSI cannot be downloaded');
  } else {
    assert.match(pkg.file_hash_sha256,/^[a-f0-9]{64}$/);
    const dl=await fetch(BASE+pkg.download_url);
    assert.equal(dl.status,200);
    const bytes=Buffer.from(await dl.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
      pkg.file_hash_sha256.toLowerCase());
  }
  const missing=await fetch(BASE+'/api/v1/msi/download/pkg-nonexistent-'+Date.now());
  assert.equal(missing.status,404);

  const build=await fetch(BASE+'/api/build/status',{headers:{Authorization:'Bearer '+adminToken}});
  assert.equal(build.status,200);
  const buildStatus=await build.json();
  assert.equal(buildStatus.msi_available,available.found);
  assert.equal(buildStatus.agent_version,version);
  console.log('[MSI gate] PASS: fixture rejected, real MSI handling honest, pending builds are not downloadable.');
}
runTests().catch(e=>{console.error('[MSI gate] FAIL:',e);process.exit(1)});
