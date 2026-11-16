import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '../../db.js';

const initialPool = db.getPool();
const initialConnected = db.isMysqlConnected();
const previousNodeEnv = process.env.NODE_ENV;
const previousFallbackFlag = process.env.ALLOW_FALLBACK_DB;

afterEach(() => {
  db.setConnectionStateForTesting(initialConnected, initialPool);
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousFallbackFlag === undefined) delete process.env.ALLOW_FALLBACK_DB;
  else process.env.ALLOW_FALLBACK_DB = previousFallbackFlag;
});

describe('production database and bootstrap credential fail-closed policies', () => {
  it('rejects production SQL fallback even with the deprecated environment override', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_FALLBACK_DB = 'true';
    db.setConnectionStateForTesting(false, null);
    await expect(db.executeQuery('SELECT * FROM devices')).rejects.toThrow(
      'Database connection unavailable in production environment'
    );
    await expect(db.executeQuery('INSERT INTO devices (id) VALUES (?)', ['example']))
      .rejects.toThrow('cannot execute query on memory fallback');
  });

  it('never accepts a stale cached device credential after revocation on another worker', async () => {
    process.env.NODE_ENV = 'production';
    const tokenHash = crypto.randomBytes(32).toString('hex');
    const device = {
      id: crypto.randomUUID(),
      hostname: 'PROD-CI-TOKEN-TEST',
      device_uid: 'ci-prod-token-uid',
      tenant_id: '00000000-0000-0000-0000-000000000091',
      device_token_hash: tokenHash,
      agent_token_revoked: 0
    };
    let revoked = false;
    let deleted = false;
    const query = vi.fn(async () => [
      deleted ? [] : [{ ...device, agent_token_revoked: revoked ? 1 : 0 }],
      []
    ]);
    db.setConnectionStateForTesting(true, { query });
    const initial = await db.getDeviceByTokenHash(tokenHash);
    expect(initial.agent_token_revoked).toBe(false);

    revoked = true; // Another API process has committed revocation.
    const afterRevocation = await db.getDeviceByTokenHash(tokenHash);
    expect(afterRevocation.agent_token_revoked).toBe(true);

    deleted = true; // A different API process has removed/rotated the token.
    expect(await db.getDeviceByTokenHash(tokenHash)).toBeNull();
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('records only hashes and scrubs redeemed package plaintext after one-use enrollment', async () => {
    const calls = [];
    const query = vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      return [[], []];
    });
    db.setConnectionStateForTesting(true, { query });
    process.env.NODE_ENV = 'test';
    const token = 'ci-bootstrap-only-' + crypto.randomBytes(22).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');

    expect(await db.markBootstrapTokenUsed(
      token, '0'.repeat(64), 'CI-AGENT-DEVICE', '00000000-0000-0000-0000-000000000091'
    )).toBe(false);
    expect(query).not.toHaveBeenCalled();

    const result = await db.markBootstrapTokenUsed(
      token, hash, 'CI-AGENT-DEVICE', '00000000-0000-0000-0000-000000000091'
    );
    expect(result).toBe(true);
    const insert = calls.find(c => c.sql.includes('INSERT INTO used_bootstrap_tokens'));
    expect(insert).toBeDefined();
    expect(insert.params[0]).toBe(hash);
    expect(insert.params[1]).toBe(null);
    expect(insert.params).not.toContain(token);
    const update = calls.find(c => c.sql.includes('UPDATE msi_packages SET used'));
    expect(update).toBeDefined();
    expect(update.sql).toMatch(/bootstrap_token = NULL/);
    expect(update.params[2]).toBe(hash);
    expect(update.params[1]).toBe(token); // lookup binding, not persisted
  });
});
