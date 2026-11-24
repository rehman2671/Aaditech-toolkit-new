import { describe, it, expect } from 'vitest';
import * as db from '../../db.js';

describe('Production device identity freshness and no demo fallback', () => {
  it('reads MySQL for every ID/hostname/UID lookup and rejects stale/demo records', async () => {
    const prior = process.env.NODE_ENV;
    let exists = true;
    const rec = {
      id: 'itk-production-read-test',
      tenant_id: '00000000-0000-0000-0000-000000000091',
      hostname: 'ITK-PRODUCTION-READ',
      device_uid: 'ITK-PRODUCTION-READ-UID',
      os_version: 'Windows',
      agent_token_revoked: 0
    };
    const pool = {
      query: async (sql) => {
        if (!sql.includes('FROM devices')) throw new Error('Unexpected test SQL');
        return [exists ? [rec] : [], []];
      }
    };
    try {
      process.env.NODE_ENV = 'production';
      db.setConnectionStateForTesting(true, pool);
      expect((await db.getDeviceById(rec.id))?.id).toBe(rec.id);
      expect((await db.getDeviceByHostname(rec.hostname))?.id).toBe(rec.id);
      expect((await db.getDeviceByUid(rec.device_uid))?.id).toBe(rec.id);
      exists = false;
      expect(await db.getDeviceById(rec.id)).toBe(null);
      expect(await db.getDeviceByHostname(rec.hostname)).toBe(null);
      expect(await db.getDeviceByUid(rec.device_uid)).toBe(null);
      // These sample devices exist only in the nonproduction demo datastore.
      expect(await db.getDeviceByHostname('DESKTOP-CORP-01')).toBe(null);
    } finally {
      db.setConnectionStateForTesting(false, null);
      if (prior === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prior;
    }
  });
});


describe('Deployed device-token authority', () => {
  it('accepts only the current unique exact hash and immediately observes rotation/deletion', async () => {
    const prior = process.env.NODE_ENV;
    const current = 'a'.repeat(64), legacy = 'b'.repeat(64), rotated = 'c'.repeat(64);
    const record = {id:'device-token-authority', hostname:'TOKEN-AUTHORITY',
      device_uid:'UID-TOKEN-AUTHORITY', tenant_id:'tenant-a',
      device_token_hash:current, auth_token_hash:legacy, agent_token_revoked:0};
    let rows = [record];
    let calls = 0;
    const pool = {query: async (sql, params) => {
      calls++;
      expect(sql).toBe('SELECT * FROM devices WHERE device_token_hash = ? LIMIT 2');
      expect(params).toHaveLength(1);
      return [rows.filter(r => r.device_token_hash?.toLowerCase() === params[0]), []];
    }};
    try {
      process.env.NODE_ENV = 'production';
      db.setConnectionStateForTesting(true, pool);
      expect((await db.getDeviceByTokenHash(current))?.id).toBe(record.id);
      expect(await db.getDeviceByTokenHash(legacy)).toBeNull();
      rows = [record, {...record, id:'duplicate-other-tenant', tenant_id:'tenant-b'}];
      expect(await db.getDeviceByTokenHash(current)).toBeNull();
      rows = [{...record, device_token_hash:current.toUpperCase()}];
      expect(await db.getDeviceByTokenHash(current)).toBeNull();
      rows = [{...record, device_token_hash:rotated}];
      expect(await db.getDeviceByTokenHash(current)).toBeNull();
      expect((await db.getDeviceByTokenHash(rotated))?.id).toBe(record.id);
      rows = [];
      expect(await db.getDeviceByTokenHash(rotated)).toBeNull();
      const before = calls;
      expect(await db.getDeviceByTokenHash('not-a-sha256')).toBeNull();
      expect(calls).toBe(before);
    } finally {
      db.setConnectionStateForTesting(false, null);
      if (prior === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prior;
    }
  });
});
