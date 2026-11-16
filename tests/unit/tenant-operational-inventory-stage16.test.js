import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';

const priorEnv = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (priorEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorEnv;
});

describe('Phase N16 tenant inventory SQL boundaries', () => {
  it('requires tenant SQL predicate on software, fleet, license and posture inventory', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        return [[], []];
      }
    });
    for (const workspace of ['tenant-A', 'tenant-B']) {
      const devices = await db.getDevices({ tenant_id: workspace });
      expect(devices).toEqual([]);
    }
    expect(queries).toHaveLength(2);
    expect(queries.every(q => /FROM devices WHERE tenant_id = \?/.test(q.sql))).toBe(true);
    expect(queries.map(q => q.params)).toEqual([['tenant-A'], ['tenant-B']]);
  });
});
