import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureSetupCode,verifySetupCode} from '../../setup-security.js';
import {encryptSecret,decryptSecret,safeSmtp,mergeSmtp,stripLegacySecrets,effectiveGitHubToken} from '../../config-secrets.js';
let dir,previousDir,previousKey;
beforeEach(()=>{
 dir=mkdtempSync(join(tmpdir(),'aaditech-setup-'));
 previousDir=process.env.DATA_DIR;previousKey=process.env.SETTINGS_ENCRYPTION_KEY;
 process.env.DATA_DIR=dir;process.env.SETTINGS_ENCRYPTION_KEY='integration-test-key-value-for-aaditech';
});
afterEach(()=>{
 if(previousDir===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previousDir;
 if(previousKey===undefined)delete process.env.SETTINGS_ENCRYPTION_KEY;else process.env.SETTINGS_ENCRYPTION_KEY=previousKey;
 rmSync(dir,{recursive:true,force:true});
});
describe('First-run secure access',()=>{
 it('creates a stable host-local setup code and denies wrong values',()=>{
  const path=ensureSetupCode(),value=readFileSync(path,'utf8').trim();
  expect(value.length).toBeGreaterThan(24);
  expect(readFileSync(ensureSetupCode(),'utf8').trim()).toBe(value);
  expect(verifySetupCode(value)).toBe(true);
  expect(verifySetupCode('incorrect')).toBe(false);
  expect(verifySetupCode('x'.repeat(500))).toBe(false);
  if(process.platform!=='win32')expect(statSync(path).mode & 0o077).toBe(0);
 });
 it('encrypts integration tokens with authenticated encryption and masks responses',()=>{
  const value='sample-secret-for-test-only',encrypted=encryptSecret(value);
  expect(encrypted).not.toContain(value);
  expect(decryptSecret(encrypted)).toBe(value);
  expect(()=>decryptSecret('v1:corrupt')).toThrow();
  const smtp=mergeSmtp({}, {provider:'custom',email:'a@example.com',password:value});
  expect(safeSmtp(smtp).password_configured).toBe(true);
  expect(JSON.stringify(safeSmtp(smtp))).not.toContain(value);
  expect(safeSmtp(smtp)).not.toHaveProperty('password_encrypted');
 });
 it('removes old plaintext branding PAT and honors host-managed token',()=>{
  expect(stripLegacySecrets({github_token:'secret',github_pat:'old',company_name:'X'})).toEqual({company_name:'X'});
  const encrypted=encryptSecret('db-token');
  expect(effectiveGitHubToken('host-token',encrypted)).toBe('host-token');
  expect(effectiveGitHubToken('',encrypted)).toBe('db-token');
 });
});
