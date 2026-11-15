import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('production first-run security boot gate', () => {
  it('rejects startup with a missing setup authorization secret', () => {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'jwt_test_secret_12345678901234567890123456789',
      HMAC_SECRET: 'hmac_test_secret_123456789012345678901234567',
      BOOTSTRAP_SECRET: 'bootstrap_test_secret_1234567890123456789',
      COMMAND_SIGNING_KEY: 'command_test_secret_1234567890123456789',
      API_TOKEN: 'api_test_secret_12345678901234567890123',
      SETUP_TOKEN: ''
    };
    const result = spawnSync(process.execPath, ['server.js'], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 10000
    });
    expect(result.status).toBe(1);
    expect((result.stderr || '') + (result.stdout || '')).toContain('SETUP_TOKEN');
  });
});
