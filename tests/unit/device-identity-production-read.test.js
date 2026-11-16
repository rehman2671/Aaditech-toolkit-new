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
