import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';
import { msiGenerateSchema } from '../../validation.js';

const priorEnv = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (priorEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorEnv;
});

describe('Production MSI package tenant and secret safeguards', () => {
  it('never allows an unscoped package list or lookup, and redacts legacy secrets', async () => {
    process.env.NODE_ENV = 'production';
    const a = '00000000-0000-0000-0000-000000000012';
    const calls = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return [[{
          id: 'package-A', tenant_id: a, package_name: 'Agent',
          version: '1.1.2', bootstrap_token: 'sensitive-plaintext',
          bootstrap_token_hash: 'sensitive-sha', file_path: '/private/install.msi',
          token_expires_at: new Date(), used: 0, downloads_count: 0
        }], []];
      }
    });
    await expect(db.getMsiPackages()).rejects.toThrow(/Tenant scope/);
    await expect(db.getMsiPackageById('package-A')).rejects.toThrow(/Tenant scope/);
    const list = await db.getMsiPackages(a);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('sensitive-plaintext');
    expect(JSON.stringify(list)).not.toContain('sensitive-sha');
    expect(JSON.stringify(list)).not.toContain('file_path');
    expect(calls[0].params).toEqual([a]);
    expect(calls[0].sql).toMatch(/WHERE tenant_id = \?/);
    expect(calls[0].sql).not.toMatch(/SELECT \*/i);
    await db.getMsiPackageById('package-A', a);
    expect(calls[1].params).toEqual(['package-A', a]);
    expect(calls[1].sql).toMatch(/WHERE id = \? AND tenant_id = \?/);
  });

  it('stores token hash only, never plaintext bootstrap in durable package record', async () => {
    process.env.NODE_ENV = 'production';
    const calls = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params) => { calls.push({ sql, params }); return [[], []]; }
    });
    await db.createMsiPackage({
      id: 'new-package', tenant_id: '00000000-0000-0000-0000-000000000012',
      package_name: 'IT-Toolkit', version: '1.1.2',
      bootstrap_token: 'one-time-confidential-credential',
      bootstrap_token_hash: 'h'.repeat(64)
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT INTO msi_packages/);
    expect(calls[0].params[4]).toBeNull();
    expect(calls[0].params[5]).toBe('h'.repeat(64));
    expect(JSON.stringify(calls[0].params)).not.toContain('one-time-confidential-credential');
  });

  it('denies MSI request bootstrap creation without a verified tenant scope', async () => {
    // Hard contract: even a SUPER_ADMIN cannot create an enrollment secret
    // against an implicit default workspace when its principal is unscoped.
    const { readFileSync } = await import('node:fs');
    const serverSource = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const block = serverSource.split("app.post('/api/v1/msi/generate'")[1]
      ?.split("app.get('/api/v1/msi/packages'")[0];
    expect(block).toContain("if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });");
    expect(block).toContain('const tenantId = req.user.tenant_id;');
    expect(block).not.toContain('req.user.tenant_id ||');
    expect(block.indexOf("if (!req.user?.tenant_id)")).toBeLessThan(
      block.indexOf('generateBootstrapToken('));
  });

  it('rejects traversal, unauthorised tenant override and unbounded expiration', () => {
    const valid = { package_name: 'IT-Toolkit-Agent-Enterprise', version: '1.1.2',
      group_id: 'production-fleet', bootstrap_expiry_hours: 48 };
    expect(msiGenerateSchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, package_name: '../escape' },
      { ...valid, package_name: 'Agent\\name' },
      { ...valid, version: '../../etc/passwd' },
      { ...valid, version: 'foo/../../secrets' },
      { ...valid, tenant_id: '00000000-0000-0000-0000-000000000099' },
      { ...valid, bootstrap_expiry_hours: 9999 },
      { ...valid, group_id: 'a:b' }
    ]) {
      expect(msiGenerateSchema.safeParse(bad).success).toBe(false);
    }
  });
});