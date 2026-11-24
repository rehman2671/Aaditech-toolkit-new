import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { getCaCertificate } from '../../agent-artifacts.js';

const priorEnv = process.env.NODE_ENV;
afterEach(() => {
  if (priorEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorEnv;
});

describe('Production TLS root CA trust boundary', () => {
  it('never auto-generates or distributes legacy CA certificates in production', () => {
    process.env.NODE_ENV = 'production';
    expect(getCaCertificate()).toBe('');
    expect(getCaCertificate()).toBe('');
  });

  it('never manufactures or exposes private CA certificates outside explicit test mode', () => {
    for (const mode of [undefined, '', 'development', 'staging', 'Production']) {
      if (mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = mode;
      expect(getCaCertificate()).toBe('');
    }
  });

  it('does not contain automatic Windows ROOT store enrollment in downloadable installer scripts', () => {
    const source = fs.readFileSync('server.js', 'utf8');
    expect(source).not.toMatch(/certutil\s+-addstore/i);
    expect(source).not.toMatch(/Import-Certificate\s+-FilePath/i);
    expect(source).toContain('LEGACY_CA_DISTRIBUTION_DISABLED');
    expect(source).toContain('Do NOT auto-import any CA file');
    const staticInstaller = fs.readFileSync('Enterprise/agent/install-agent.cmd', 'utf8');
    expect(staticInstaller).not.toMatch(/certutil\s+-addstore/i);
    expect(staticInstaller).toContain('Never import bundled/self-signed roots');
  });
});
