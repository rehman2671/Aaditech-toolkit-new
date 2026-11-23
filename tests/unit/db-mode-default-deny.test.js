import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import * as db from '../../db.js';
import { app } from '../../server.js';

const initialEnv = process.env.NODE_ENV;
const initialFallback = process.env.ALLOW_FALLBACK_DB;
const initialConnection = db.isMysqlConnected();
const initialPool = db.getPool();

afterEach(() => {
  db.setConnectionStateForTesting(initialConnection, initialPool);
  if (initialEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = initialEnv;
  if (initialFallback === undefined) delete process.env.ALLOW_FALLBACK_DB;
  else process.env.ALLOW_FALLBACK_DB = initialFallback;
});

describe('P0 persistent MySQL admission in every deployed runtime', () => {
  for (const env of [undefined, 'development', 'staging', 'Production', 'production']) {
    it('fails closed on MySQL outage when NODE_ENV=' + String(env), async () => {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      process.env.ALLOW_FALLBACK_DB = 'true';
      db.setConnectionStateForTesting(false, null);
      await expect(db.executeQuery('SELECT * FROM users')).rejects.toThrow(
        'cannot execute query on memory fallback');
      await expect(db.getDeviceByHostname('DESKTOP-CORP-01')).rejects.toThrow(
        'cannot execute query on memory fallback');
      await expect(db.getEnrollmentIdentityMatches('DESKTOP-CORP-01', 'offline-uid'))
        .rejects.toThrow('Cannot check enrollment ownership without MySQL.');
      const health = await request(app).get('/healthz');
      expect(health.status).toBe(503);
      expect(health.body.status).toBe('degraded');
      expect(health.body.components.database).toBe('DEGRADED');
    });
  }

  it('never swallows a failed connected-MySQL query into an in-memory success', async () => {
    process.env.NODE_ENV = 'staging';
    const fail = vi.fn(async () => { throw Object.assign(new Error('database offline'), { code: 'ECONNRESET' }); });
    db.setConnectionStateForTesting(true, { query: fail });
    await expect(db.executeQuery('SELECT * FROM users')).rejects.toThrow('database offline');
    expect(fail).toHaveBeenCalledOnce();
  });

  it('keeps synthetic SQL fixtures restricted to explicit NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    db.setConnectionStateForTesting(false, null);
    const rows = await db.executeQuery('SELECT * FROM users');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const health = await request(app).get('/healthz');
    expect(health.status).toBe(200);
    expect(health.body.components.database).toBe('DEGRADED');
  });
});
