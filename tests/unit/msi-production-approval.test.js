import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchesApprovedReleaseHash } from '../../agent-artifacts.js';

const previousEnv = process.env.NODE_ENV;
const previousHash = process.env.APPROVED_MSI_SHA256;
afterEach(() => {
  if (previousEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnv;
  if (previousHash === undefined) delete process.env.APPROVED_MSI_SHA256;
  else process.env.APPROVED_MSI_SHA256 = previousHash;
});
describe('Production MSI download approval', () => {
  it('denies an existing artifact when no approved hash is configured', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itk-release-'));
    const file = path.join(dir, 'agent.msi');
    try {
      fs.writeFileSync(file, crypto.randomBytes(30000));
      process.env.NODE_ENV = 'production';
      delete process.env.APPROVED_MSI_SHA256;
      expect(matchesApprovedReleaseHash(file)).toBe(false);
      process.env.APPROVED_MSI_SHA256 = '0'.repeat(64);
      expect(matchesApprovedReleaseHash(file)).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('denies unapproved MSI bytes outside explicit tests, even with NODE_ENV unset', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itk-release-'));
    const file = path.join(dir, 'agent.msi');
    try {
      const bytes = crypto.randomBytes(30000);
      fs.writeFileSync(file, bytes);
      const exact = crypto.createHash('sha256').update(bytes).digest('hex');
      for (const environment of [undefined, 'development', 'staging', 'Production']) {
        if (environment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = environment;
        delete process.env.APPROVED_MSI_SHA256;
        expect(matchesApprovedReleaseHash(file)).toBe(false);
        process.env.APPROVED_MSI_SHA256 = '0'.repeat(64);
        expect(matchesApprovedReleaseHash(file)).toBe(false);
        process.env.APPROVED_MSI_SHA256 = exact;
        expect(matchesApprovedReleaseHash(file)).toBe(true);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('requires exact approved bytes and refuses synthetic MSI placeholder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itk-release-'));
    const file = path.join(dir, 'agent.msi');
    try {
      process.env.NODE_ENV = 'production';
      const bytes = crypto.randomBytes(30000);
      fs.writeFileSync(file, bytes);
      process.env.APPROVED_MSI_SHA256 = crypto.createHash('sha256').update(bytes).digest('hex');
      expect(matchesApprovedReleaseHash(file)).toBe(true);
      fs.appendFileSync(file, 'tampered');
      expect(matchesApprovedReleaseHash(file)).toBe(false);
      const tiny = Buffer.alloc(1536);
      fs.writeFileSync(file, tiny);
      process.env.APPROVED_MSI_SHA256 = crypto.createHash('sha256').update(tiny).digest('hex');
      expect(matchesApprovedReleaseHash(file)).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
