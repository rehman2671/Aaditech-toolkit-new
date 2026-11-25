import { describe, it, expect, vi, afterEach } from 'vitest';
import * as db from '../../db.js';

const originalPool = db.getPool();
const originalConnected = db.isMysqlConnected();

afterEach(() => {
  db.setConnectionStateForTesting(originalConnected, originalPool);
});

describe('concurrent device identity ownership locks', () => {
  it('serializes the same hostname even when competing device UIDs differ', async () => {
    db.setConnectionStateForTesting(false, null);
    const events = [];
    let unblock;
    const gate = new Promise(resolve => { unblock = resolve; });
    const first = db.withDeviceIdentityLock('SAME-HOST', 'uid-a', async () => {
      events.push('first-start');
      await gate;
      events.push('first-end');
    });
    const second = db.withDeviceIdentityLock('same-host', 'uid-b', async () => {
      events.push('second-start');
      events.push('second-end');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['first-start']);
    unblock();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start','first-end','second-start','second-end']);
  });

  it('acquires and releases two hashed MySQL session locks on success', async () => {
    const query = vi.fn(async sql => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      return [[{ released: 1 }]];
    });
    const release = vi.fn();
    const destroy = vi.fn();
    const getConnection = vi.fn(async () => ({ query, release, destroy }));
    db.setConnectionStateForTesting(true, { getConnection });
    const result = await db.withDeviceIdentityLock('MY-CI-HOST', 'my-device-uid', async () => 42);
    expect(result).toBe(42);
    expect(query.mock.calls.filter(([sql]) => sql.includes('GET_LOCK'))).toHaveLength(2);
    expect(query.mock.calls.filter(([sql]) => sql.includes('RELEASE_LOCK'))).toHaveLength(2);
    for (const [sql, args] of query.mock.calls) {
      expect(sql).toContain('LOCK');
      expect(args[0].length).toBeLessThanOrEqual(64);
    }
    expect(release).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('releases any acquired MySQL lock and connection after a timeout', async () => {
    let acquisitions = 0;
    const query = vi.fn(async sql => {
      if (sql.includes('GET_LOCK')) {
        acquisitions++;
        return [[{ acquired: acquisitions === 1 ? 1 : 0 }]];
      }
      return [[{ released: 1 }]];
    });
    const release = vi.fn();
    const destroy = vi.fn();
    db.setConnectionStateForTesting(true, {
      getConnection: vi.fn(async () => ({ query, release, destroy }))
    });
    await expect(db.withDeviceIdentityLock('lock-timeout', 'different-uid', async () => {
      throw new Error('callback must not run');
    })).rejects.toThrow('timed out');
    expect(query.mock.calls.filter(([sql]) => sql.includes('RELEASE_LOCK'))).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('rejects invalid input and never runs an untrusted callback', async () => {
    await expect(db.withDeviceIdentityLock('', 'uid', async () => 1))
      .rejects.toThrow('Hostname and device UID required');
    await expect(db.withDeviceIdentityLock('host', 'uid', null))
      .rejects.toThrow('callback');
  });
});
