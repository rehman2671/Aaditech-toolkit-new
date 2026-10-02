import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Boot-Time Security Validation (Strict Zero-Fallback Secrets)', () => {
  const baseEnv = {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    VITEST: 'false',
    DOTENV_CONFIG_PATH: '/dev/null',
    JWT_SECRET: 'test_jwt_secret_valid',
    BOOTSTRAP_SECRET: 'test_bootstrap_secret_valid',
    COMMAND_SIGNING_KEY: 'test_command_signing_key_valid',
    HMAC_SECRET: 'test_hmac_secret_valid',
    API_TOKEN: 'test_api_token_valid'
  };

  it('refuses to start (exits non-zero) when JWT_SECRET is unset', () => {
    const env = { ...baseEnv };
    delete env.JWT_SECRET;
    const res = spawnSync('node', ['server.js'], { cwd: rootDir, env, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/JWT_SECRET environment variable is required/);
  });

  it('refuses to start (exits non-zero) when HMAC_SECRET is unset', () => {
    const env = { ...baseEnv };
    delete env.HMAC_SECRET;
    const res = spawnSync('node', ['server.js'], { cwd: rootDir, env, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/HMAC_SECRET environment variable is required/);
  });

  it('refuses to start (exits non-zero) when API_TOKEN is unset', () => {
    const env = { ...baseEnv };
    delete env.API_TOKEN;
    const res = spawnSync('node', ['server.js'], { cwd: rootDir, env, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/API_TOKEN environment variable is required/);
  });

  it('refuses to start (exits non-zero) when BOOTSTRAP_SECRET is unset', () => {
    const env = { ...baseEnv };
    delete env.BOOTSTRAP_SECRET;
    const res = spawnSync('node', ['server.js'], { cwd: rootDir, env, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/BOOTSTRAP_SECRET environment variable is required/);
  });

  it('refuses to start (exits non-zero) when COMMAND_SIGNING_KEY is unset', () => {
    const env = { ...baseEnv };
    delete env.COMMAND_SIGNING_KEY;
    const res = spawnSync('node', ['server.js'], { cwd: rootDir, env, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/COMMAND_SIGNING_KEY environment variable is required/);
  });
});
