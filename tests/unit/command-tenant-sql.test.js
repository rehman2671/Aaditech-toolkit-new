import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';

const prior = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (prior === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prior;
});
describe('Phase N12 command/alert tenant SQL guarantees', () => {
  it('joins command inventory through the owning device and never uses demo fallback', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params) => { queries.push({sql,params}); return [[],[]]; }
    });
    const commands = await db.getCommands({ tenant_id: 'tenant-B', status: 'pending' });
    expect(commands).toEqual([]);
    expect(queries[0].sql).toMatch(/JOIN devices d ON d.id = cq.device_id/);
    expect(queries[0].sql).toMatch(/d.tenant_id = \?/);
    expect(queries[0].sql).toMatch(/cq.status = \?/);
    expect(queries[0].params).toEqual(['tenant-B', 'PENDING']);
  });
  it('requires alerts to be filtered by tenant in SQL', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params) => { queries.push({sql,params}); return [[],[]]; }
    });
    await db.getAlerts({ status: 'open', tenant_id: 'tenant-B' });
    expect(queries[0].sql).toMatch(/tenant_id = \?/);
    expect(queries[0].params).toEqual(['open','tenant-B']);
  });
});
