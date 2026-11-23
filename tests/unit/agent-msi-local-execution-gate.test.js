import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';

async function download(path) {
  const res = await request(app).get(path).set('Host', '127.0.0.1:3000');
  expect(res.status).toBe(200);
  return res.text;
}

describe('P0 generated Windows installers reject unsigned or unapproved MSI execution', () => {
  it('PowerShell requires both fingerprints and valid Authenticode before any file write', async () => {
    const script = await download('/api/v1/agent/install.ps1');
    for (const key of ['AADITECH_APPROVED_MSI_SHA256',
      'AADITECH_APPROVED_SIGNER_CERT_SHA256', 'MSI_RELEASE_APPROVAL_REQUIRED',
      'Get-FileHash -LiteralPath $msiPath -Algorithm SHA256',
      'Get-AuthenticodeSignature -LiteralPath $msiPath',
      "Status -ne 'Valid'", 'SignerCertificate.RawData',
      'MSI_RELEASE_SIGNER_NOT_APPROVED']) expect(script).toContain(key);
    expect(script.indexOf('MSI_RELEASE_APPROVAL_REQUIRED')).toBeLessThan(script.indexOf('New-Item -ItemType Directory'));
    expect(script.indexOf('Get-AuthenticodeSignature')).toBeLessThan(script.indexOf('Set-Content -Path $agentJsonPath'));
    expect(script.indexOf('Get-AuthenticodeSignature')).toBeLessThan(script.indexOf('Start-Process "msiexec.exe"'));
    expect(script).not.toContain('Get-ChildItem -Path $ScriptDir -Filter "*.msi"');
    expect(script).not.toContain('Created configuration files for standalone run.');
    expect(script).not.toContain('registers Enterprise Root CA');
  });
  it('CMD uses both pins and Windows signature preflight before config and msiexec', async () => {
    const script = await download('/api/v1/agent/install.cmd');
    for (const key of ['AADITECH_APPROVED_MSI_SHA256',
      'AADITECH_APPROVED_SIGNER_CERT_SHA256',
      'Get-FileHash -LiteralPath $p -Algorithm SHA256',
      'Get-AuthenticodeSignature -LiteralPath $p',
      "$a.Status -ne 'Valid'", '$a.SignerCertificate.RawData',
      'if errorlevel 1 (', 'No installation or configuration change']) expect(script).toContain(key);
    expect(script.indexOf('Get-AuthenticodeSignature')).toBeLessThan(script.indexOf('if not exist "%TARGET_DIR%" mkdir'));
    expect(script.indexOf('Get-AuthenticodeSignature')).toBeLessThan(script.indexOf('msiexec /i'));
    expect(script).not.toContain('if not defined MSI_FILE');
    expect(script).not.toContain('if defined MSI_FILE (');
  });
});
