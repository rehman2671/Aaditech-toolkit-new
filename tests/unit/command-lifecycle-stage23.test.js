import { afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '../../db.js';
import { commandResultSchema } from '../../validation.js';

const originalMode = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (originalMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalMode;
});

describe('Phase N23 command queue: database is authoritative', () => {
  it('fails closed on failed MySQL insert; never queues a ghost command', async () => {
    process.env.NODE_ENV = 'production';
    const writes = [];
    db.setConnectionStateForTesting(true, { query: async (sql) => {
      writes.push(sql);
      if (sql.includes('INSERT INTO command_queue')) {
        throw Object.assign(new Error('simulated MySQL disk outage'), { code: 'ER_DISK_FULL' });
      }
      return [[], []];
    }});
    const command = { id: 'n23-db-failure', device_id: 'device-A', kind: 'DIAGNOSTIC', payload: {} };
    await expect(db.queueCommandInDb(command)).rejects.toMatchObject({ code: 'ER_DISK_FULL' });
    expect(writes.some(sql => sql.includes('INSERT INTO command_queue'))).toBe(true);
    expect(await db.getCommandById(command.id)).toBeNull();
    expect(await db.getPendingCommandsForDevice(command.device_id)).toEqual([]);
  });

  it('does not reuse a development shadow command in production SQL reads', async () => {
    process.env.NODE_ENV = 'test';
    const command = { id: 'n23-shadow-command', device_id: 'dev-X', kind: 'DIAGNOSTIC', payload: {} };
    expect(await db.queueCommandInDb(command)).toBe(true);
    expect((await db.getCommandById(command.id))?.id).toBe(command.id);
    process.env.NODE_ENV = 'production';
    const observed = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      observed.push({ sql, params });
      return [[], []];
    }});
    expect(await db.getCommandById(command.id)).toBeNull();
    expect(await db.getPendingCommandsForDevice('dev-X')).toEqual([]);
    expect(observed.map(x => x.sql).join('\n')).toContain('SELECT * FROM command_queue WHERE id = ?');
    expect(observed.length).toBe(2);
  });

  it('uses a single compare-and-swap claim for concurrent agent pollers', async () => {
    process.env.NODE_ENV = 'production';
    let pending = true;
    const operations = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      operations.push({ sql, params });
      if (sql.startsWith('UPDATE command_queue SET')) {
        const accepted = pending && params[0] === 'cmd-1' && params[1] === 'device-1';
        pending = false;
        return [{ affectedRows: accepted ? 1 : 0 }, []];
      }
      return [[], []];
    }});
    const results = await Promise.all([
      db.markCommandPickedUp('cmd-1', 'device-1'),
      db.markCommandPickedUp('cmd-1', 'device-1'),
      db.markCommandPickedUp('cmd-1', 'wrong-device')
    ]);
    expect(results).toEqual([true, false, false]);
    expect(operations).toHaveLength(3);
    expect(operations.every(op => op.sql.includes("AND device_id = ? AND status = 'PENDING'"))).toBe(true);
  });

  it('fences completion by device + in-progress state; rejects duplicates', async () => {
    process.env.NODE_ENV = 'production';
    let state = 'PENDING';
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes("status = 'IN_PROGRESS'")) {
        if (state !== 'IN_PROGRESS' || params[5] !== 'device-A') return [{ affectedRows: 0 }, []];
        state = 'COMPLETED';
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes("status = 'PENDING'")) {
        if (state !== 'PENDING' || params[1] !== 'device-A') return [{ affectedRows: 0 }, []];
        state = 'IN_PROGRESS';
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    }});
    expect(await db.completeCommandInDb('cmd-X', 'completed', 'done', '', 0, 'device-A')).toBe(false);
    expect(await db.markCommandPickedUp('cmd-X', 'device-A')).toBe(true);
    expect(await db.completeCommandInDb('cmd-X', 'completed', 'done', '', 0, 'device-B')).toBe(false);
    expect(await db.completeCommandInDb('cmd-X', 'completed', 'done', '', 0, 'device-A')).toBe(true);
    expect(await db.completeCommandInDb('cmd-X', 'failed', 'late overwrite', '', 1, 'device-A')).toBe(false);
    expect(queries.filter(q => q.sql.includes("status = 'IN_PROGRESS'"))).toHaveLength(4);
    expect(queries.every(q => q.sql.includes('device_id = ?'))).toBe(true);
    expect(state).toBe('COMPLETED');
  });

  it('rejects oversized/unrecognized result bodies and invalid states', () => {
    expect(commandResultSchema.safeParse({ status: 'completed', output: 'ok', exit_code: 0 }).success).toBe(true);
    expect(commandResultSchema.safeParse({ status: 'running' }).success).toBe(false);
    expect(commandResultSchema.safeParse({ status: 'completed', output: 'X'.repeat(32769) }).success).toBe(false);
    expect(commandResultSchema.safeParse({ status: 'completed', bogus: true }).success).toBe(false);
    expect(commandResultSchema.safeParse({ status: 'completed', exit_code: 2147483648 }).success).toBe(false);
  });

  it('fails closed on database update errors without fabricated acknowledgment', async () => {
    process.env.NODE_ENV = 'production';
    db.setConnectionStateForTesting(true, { query: async () => {
      throw Object.assign(new Error('MySQL unavailable'), { code: 'ECONNRESET' });
    }});
    await expect(db.markCommandPickedUp('cmd-F', 'device-A')).rejects.toMatchObject({ code: 'ECONNRESET' });
    await expect(db.completeCommandInDb('cmd-F', 'completed', '', '', 0, 'device-A'))
      .rejects.toThrow('Database connection unavailable');
  });
});
