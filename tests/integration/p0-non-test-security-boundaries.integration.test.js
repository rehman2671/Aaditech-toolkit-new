import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as db from '../../db.js';
import { app } from '../../server.js';
import { resolveAgentOrigin } from '../../agent-origin.js';
import { getCaCertificate } from '../../agent-artifacts.js';
import { requiresPersistedUserAuthorization, resolveVerifiedUserPrincipal } from '../../auth-principal.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalServerHost = process.env.SERVER_HOST;
const originalPool = db.getPool();
const originalConnected = db.isMysqlConnected();

afterEach(() => {
  db.setConnectionStateForTesting(originalConnected, originalPool);
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalServerHost === undefined) delete process.env.SERVER_HOST;
  else process.env.SERVER_HOST = originalServerHost;
});

describe('P0 deployed security admission across database, agent trust and health', () => {
  it('fails all public-facing claims closed during a staging DB outage and forged Host', async () => {
    process.env.NODE_ENV = 'staging';
    delete process.env.SERVER_HOST;
    db.setConnectionStateForTesting(false, null);

    const health = await request(app).get('/healthz')
      .set('Host', 'attacker.example.org');
    expect(health.status).toBe(503);
    expect(health.body.status).toBe('degraded');
    expect(health.body.components).toMatchObject({
      database: 'DEGRADED',
      ingest_queue: 'NOT_VERIFIED',
      msi_builder: 'EXTERNAL_SIGNING_REQUIRED',
      audit_engine: 'NOT_VERIFIED'
    });

    const restricted = await request(app).get('/api/v1/commands/poll')
      .set('Host', 'attacker.example.org')
      .set('X-Agent-Signature', 'a'.repeat(64))
      .set('X-Device-UID', 'device-unauthorized')
      .set('X-Timestamp', String(Date.now()));
    expect(restricted.status).toBe(503);
    expect(restricted.body.error).toBe('DATABASE_UNAVAILABLE');

    // Never fall back to an attacker-supplied Host, synthetic root, or JWT
    // claims just because production's NODE_ENV string is noncanonical.
    expect(resolveAgentOrigin({
      headers: { host: 'attacker.example.org', 'x-forwarded-proto': 'http' },
      protocol: 'http'
    })).toBeNull();
    expect(getCaCertificate()).toBe('');
    expect(requiresPersistedUserAuthorization('staging')).toBe(true);
    expect(resolveVerifiedUserPrincipal({
      id: 11, tenant_id: 'forged-tenant', role: 'SUPER_ADMIN',
      username: 'not-a-current-user'
    }, null, v => String(v || '').toUpperCase())).toBeNull();
  });

  it('rejects legacy CA delivery even if a staging MySQL pool is marked connected', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.SERVER_HOST = 'office.example.org';
    let sqlCalls = 0;
    db.setConnectionStateForTesting(true, {
      query: async () => {
        sqlCalls += 1;
        throw new Error('Legacy CA refusal must not consult SQL');
      }
    });

    expect(resolveAgentOrigin({
      headers: { host: 'attacker.example.org', 'x-forwarded-proto': 'http' },
      protocol: 'http'
    })).toEqual({ host: 'office.example.org', protocol: 'https' });

    for (const route of ['/api/ca.crt', '/api/v1/ca.crt']) {
      const denied = await request(app).get(route).set('Host', 'attacker.example.org');
      expect(denied.status).toBe(410);
      expect(denied.body.error).toBe('LEGACY_CA_DISTRIBUTION_DISABLED');
    }
    expect(sqlCalls).toBe(0);
  });
});
