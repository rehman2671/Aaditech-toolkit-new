import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { app } from '../../server.js';
import * as db from '../../db.js';

const beforeMode = process.env.NODE_ENV;
const priorConnected = db.isMysqlConnected();
const priorPool = db.getPool();

afterEach(() => {
  if (beforeMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = beforeMode;
  db.setConnectionStateForTesting(priorConnected, priorPool);
});

describe('Non-test session, user creation and CA trust boundary', () => {
  it('rejects public CA download in staging even if database is healthy', async () => {
    process.env.NODE_ENV = 'staging';
    db.setConnectionStateForTesting(true, {
      query: async () => { throw new Error('Unexpected SQL on legacy CA rejection'); }
    });
    for (const path of ['/api/ca.crt', '/api/v1/ca.crt']) {
      const response = await request(app).get(path);
      expect(response.status).toBe(410);
      expect(response.body.error).toBe('LEGACY_CA_DISTRIBUTION_DISABLED');
    }
  });

  it('requires secure cookies and explicit user passwords in every deployed runtime', () => {
    const source = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    expect(source).toContain("if (process.env.NODE_ENV !== 'test' && !password)");
    expect(source).not.toContain("if (process.env.NODE_ENV === 'production' && !password)");
    const secureCookies = source.match(/secure: process\.env\.NODE_ENV !== 'test'/g) || [];
    expect(secureCookies).toHaveLength(6);
    expect(source).not.toContain("secure: process.env.NODE_ENV === 'production'");
    expect(source).toContain("server_host: process.env.NODE_ENV !== 'test'");
  });
});
