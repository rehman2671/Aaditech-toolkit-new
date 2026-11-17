import { afterEach, describe, expect, it } from 'vitest';
import * as db from '../../db.js';

const savedMode = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (savedMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedMode;
});
describe('Stage N22 event device and tenant identity', () => {
  it('requires trusted tenant/device ownership before writing events in production', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      queries.push({ sql, params });
      return [{ insertId: 20 }, []];
    }});
    await expect(db.addEvent({ hostname: 'DUPLICATE-PC', kind: 'telemetry' }))
      .rejects.toThrow('EVENT_DEVICE_TENANT_REQUIRED');
    await expect(db.addEvent({ tenant_id: 'tenant-A', hostname: 'DUPLICATE-PC', kind: 'telemetry' }))
      .rejects.toThrow('EVENT_DEVICE_TENANT_REQUIRED');
    expect(queries).toHaveLength(0);
    await db.addEvent({ tenant_id: 'tenant-A', device_id: 'device-A',
      hostname: 'DUPLICATE-PC', kind: 'service_state', payload: { service: 'Spooler' } });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/INSERT INTO events \(tenant_id, device_id, hostname/);
    expect(queries[0].params.slice(0, 4)).toEqual(['tenant-A', 'device-A', 'DUPLICATE-PC', 'service_state']);
  });

  it('queries event ownership on event rows, not hostname-based device join', async () => {
    process.env.NODE_ENV = 'production';
    const sql = [];
    db.setConnectionStateForTesting(true, { query: async (statement, params = []) => {
      sql.push({ statement, params });
      return [[{ id: 44, tenant_id: 'tenant-A', device_id: 'device-A', hostname: 'DUPLICATE-PC',
        sanitized: 1, payload: JSON.stringify({ type: 'test' }) }], []];
    }});
    const result = await db.getEvents('DUPLICATE-PC', 10, 'service_state', 'tenant-A', 'device-A');
    expect(result[0].tenant_id).toBe('tenant-A');
    expect(result[0].payload).toEqual({ type: 'test' });
    const q = sql[0];
    expect(q.statement).toContain('FROM events');
    expect(q.statement).toContain('tenant_id = ?');
    expect(q.statement).toContain('device_id = ?');
    expect(q.statement).not.toMatch(/JOIN devices|devices.hostname/i);
    expect(q.params).toEqual(['tenant-A', 'device-A', 'DUPLICATE-PC', 'service_state', 10]);
  });

  it('tenant event lists always filter tenant, even when no hostname is supplied', async () => {
    process.env.NODE_ENV = 'production';
    const query = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      query.push({ sql, params });
      return [[], []];
    }});
    expect(await db.getEvents(null, 20, null, 'tenant-B')).toEqual([]);
    expect(query[0].sql).toContain('WHERE tenant_id = ?');
    expect(query[0].params).toEqual(['tenant-B', 20]);
    expect(query[0].sql).not.toContain('JOIN');
  });
});
