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
