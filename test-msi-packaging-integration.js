import assert from 'assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('=== Starting MSI Packaging Integration Tests ===');

  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

  // 1. Verify agent version resolution
  const versionFile = path.join(__dirname, 'Enterprise', 'agent', 'agent-version.json');
  assert.ok(fs.existsSync(versionFile), 'agent-version.json must exist');
  const meta = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  const expectedVersion = meta.agent_version;
  console.log(`[PASS] Verified agent-version.json source of truth: ${expectedVersion}`);

  // 2. Test GET /api/agent-bundle
  const bundleRes = await fetch(`${BASE_URL}/api/agent-bundle`);
  assert.strictEqual(bundleRes.status, 200, '/api/agent-bundle should return 200');
  const bundleData = await bundleRes.json();
  assert.strictEqual(bundleData.agent_json.agent_version, expectedVersion, 'agent_version must match agent-version.json');
  assert.strictEqual(bundleData.msi_available, true, 'msi_available should be true when artifact exists');
  assert.ok(bundleData.msi_size > 1000, 'msi_size should reflect real file byte size');
  assert.strictEqual(bundleData.msi_filename, `IT-Toolkit-Agent-${expectedVersion}.msi`);
  assert.ok(bundleData.ca_cert && bundleData.ca_cert.includes('BEGIN CERTIFICATE'), 'ca_cert must be present');
  console.log(`[PASS] /api/agent-bundle verified with real version ${expectedVersion} and size ${bundleData.msi_size} bytes`);

  // 3. Test GET /api/ca.crt
  const caRes = await fetch(`${BASE_URL}/api/ca.crt`);
  assert.strictEqual(caRes.status, 200, '/api/ca.crt should return 200');
  const caCertText = await caRes.text();
  assert.ok(caCertText.includes('-----BEGIN CERTIFICATE-----'), 'ca.crt must contain PEM header');
  assert.ok(caCertText.includes('-----END CERTIFICATE-----'), 'ca.crt must contain PEM footer');
  assert.ok(!caCertText.includes('...'), 'ca.crt must never contain fabricated placeholder dots');
  const parsedCert = new crypto.X509Certificate(caCertText);
  assert.ok(parsedCert.subject.includes('IT-Toolkit'), 'X509Certificate should be valid and have IT-Toolkit subject');
  console.log(`[PASS] /api/ca.crt verified as valid X.509 Certificate: ${parsedCert.subject}`);

  // 4. Test GET /api/agent-msi
  const msiRes = await fetch(`${BASE_URL}/api/agent-msi`);
  assert.strictEqual(msiRes.status, 200, '/api/agent-msi should return 200');
  const msiContentType = msiRes.headers.get('content-type');
  assert.ok(msiContentType && msiContentType.includes('application/x-msi'), 'Content-Type must be application/x-msi');

  const msiBuffer = Buffer.from(await msiRes.arrayBuffer());
  assert.ok(msiBuffer.length > 500, `MSI size must be real installer, got ${msiBuffer.length} bytes`);
  const magic = msiBuffer.subarray(0, 8).toString('hex').toUpperCase();
  assert.strictEqual(magic, 'D0CF11E0A1B11AE1', 'MSI must have OLE CFBF magic bytes D0 CF 11 E0 A1 B1 1A E1');
  console.log(`[PASS] /api/agent-msi verified with magic bytes ${magic} (${msiBuffer.length} bytes)`);

  // 5. Test POST /api/v1/msi/generate with Super Admin Auth
  const adminToken = jwt.sign({
    id: 1,
    username: 'superadmin',
    email: 'admin@corp.internal',
    role: 'SUPER_ADMIN',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    jti: crypto.randomUUID()
  }, process.env.JWT_SECRET || 'aaditech_enterprise_jwt_super_secret_key_2026_dev', { expiresIn: '1h' });

  const genRes = await fetch(`${BASE_URL}/api/v1/msi/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      package_name: 'IT-Toolkit-Agent-Enterprise',
      version: expectedVersion,
      group_id: 'production-fleet',
      bootstrap_expiry_hours: 48
    })
  });

  assert.strictEqual(genRes.status, 201, 'POST /api/v1/msi/generate should return 201 Created');
  const genData = await genRes.json();
  assert.ok(genData.id, 'Response must have package id');
  assert.strictEqual(genData.version, expectedVersion);
  assert.strictEqual(genData.status, 'READY', 'Package with real artifact should be marked READY');
  assert.ok(genData.file_hash_sha256, 'file_hash_sha256 must be computed');
  assert.strictEqual(genData.file_hash_sha256.length, 64, 'SHA-256 hash must be 64 hex chars');
  assert.ok(genData.bootstrap_token, 'bootstrap_token must be generated');
  console.log(`[PASS] POST /api/v1/msi/generate created package ${genData.id} with status READY and hash ${genData.file_hash_sha256}`);

  // 6. Test GET /api/v1/msi/download/:id
  const dlRes = await fetch(`${BASE_URL}${genData.download_url}`);
  assert.strictEqual(dlRes.status, 200, 'GET /api/v1/msi/download/:id should return 200');
  const dlContentType = dlRes.headers.get('content-type');
  assert.ok(dlContentType && dlContentType.includes('application/x-msi'), 'Content-Type must be application/x-msi, not application/zip');

  const dlBuffer = Buffer.from(await dlRes.arrayBuffer());
  const dlMagic = dlBuffer.subarray(0, 8).toString('hex').toUpperCase();
  assert.strictEqual(dlMagic, 'D0CF11E0A1B11AE1', 'Downloaded file must be an OLE CFBF MSI document');

  const actualSha256 = crypto.createHash('sha256').update(dlBuffer).digest('hex');
  assert.strictEqual(actualSha256, genData.file_hash_sha256, 'Downloaded bytes SHA-256 must exactly match database record');
  console.log(`[PASS] GET /api/v1/msi/download/:id streamed authentic MSI with matching hash ${actualSha256}`);

  // 7. Test 404 behavior for non-existent MSI package
  const fakeRes = await fetch(`${BASE_URL}/api/v1/msi/download/00000000-0000-0000-0000-000000000000`);
  assert.strictEqual(fakeRes.status, 404, 'Non-existent package ID should return 404');
  console.log('[PASS] 404 handling verified for non-existent package');

  // 8. Test GET /api/build/status
  const statusRes = await fetch(`${BASE_URL}/api/build/status`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.strictEqual(statusRes.status, 200, '/api/build/status should return 200');
  const statusData = await statusRes.json();
  assert.strictEqual(statusData.msi_available, true, 'build status msi_available must reflect disk state');
  assert.strictEqual(statusData.agent_version, expectedVersion, 'build status agent_version must match source of truth');
  console.log(`[PASS] /api/build/status verified: msi_available=${statusData.msi_available}, version=${statusData.agent_version}`);

  console.log('=== ALL MSI PACKAGING INTEGRATION TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
