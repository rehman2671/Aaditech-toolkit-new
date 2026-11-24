import { afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '../../db.js';
import { commandResultSchema } from '../../validation.js';

const originalMode = process.env.NODE_ENV;
const credential = {tenantId:'tenant-A',tokenHash:'a'.repeat(64)};
function transactionPool(query, owner = null) {
  const conn = {beginTransaction:vi.fn(async()=>{}),commit:vi.fn(async()=>{}),
    rollback:vi.fn(async()=>{}),release:vi.fn(),
    query:vi.fn(async(sql,params)=>{
      if(sql.includes('FROM devices') && sql.includes('FOR UPDATE')) {
        const row=owner || {id:params[0],tenant_id:params[1],device_token_hash:credential.tokenHash,agent_token_revoked:0};
        return [[row],[]];
      }
      return query(sql,params);
    })};
  return {conn,pool:{getConnection:async()=>conn}};
}
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
    const {pool}=transactionPool(async (sql, params = []) => {
      operations.push({ sql, params });
      if (sql.startsWith('UPDATE command_queue SET')) {
        const accepted = pending && params[0] === 'cmd-1' && params[1] === 'device-1';
        pending = false;
        return [{ affectedRows: accepted ? 1 : 0 }, []];
      }
      return [[], []];
    });
    db.setConnectionStateForTesting(true,pool);
    const results = await Promise.all([
      db.markCommandPickedUp('cmd-1', 'device-1', credential),
      db.markCommandPickedUp('cmd-1', 'device-1', credential),
      db.markCommandPickedUp('cmd-1', 'wrong-device', credential)
    ]);
    expect(results).toEqual([true, false, false]);
    expect(operations).toHaveLength(3);
    expect(operations.every(op => op.sql.includes("AND device_id = ? AND status = 'PENDING'"))).toBe(true);
  });

  it('fences completion by device + in-progress state; rejects duplicates', async () => {
    process.env.NODE_ENV = 'production';
    let state = 'PENDING';
    const queries = [];
    const {pool}=transactionPool(async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes("AND status = 'IN_PROGRESS'")) {
        if (state !== 'IN_PROGRESS' || params[5] !== 'device-A') return [{ affectedRows: 0 }, []];
        state = 'COMPLETED';
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes("AND status = 'PENDING'")) {
        if (state !== 'PENDING' || params[1] !== 'device-A') return [{ affectedRows: 0 }, []];
        state = 'IN_PROGRESS';
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    });
    db.setConnectionStateForTesting(true,pool);
    expect(await db.completeCommandInDb('cmd-X', 'completed', 'done', '', 0, 'device-A', credential)).toBe(false);
    expect(await db.markCommandPickedUp('cmd-X', 'device-A', credential)).toBe(true);
    expect(await db.completeCommandInDb('cmd-X', 'completed', 'done', '', 0, 'device-B', credential)).toBe(false);
    expect(await db.completeCommandInDb('cmd-X', 'completed', 'done', '', 0, 'device-A', credential)).toBe(true);
    expect(await db.completeCommandInDb('cmd-X', 'failed', 'late overwrite', '', 1, 'device-A', credential)).toBe(false);
    expect(queries.filter(q => q.sql.includes("AND status = 'IN_PROGRESS'"))).toHaveLength(4);
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
    const {pool,conn}=transactionPool(async () => {
      throw Object.assign(new Error('MySQL unavailable'), { code: 'ECONNRESET' });
    });
    db.setConnectionStateForTesting(true,pool);
    await expect(db.markCommandPickedUp('cmd-F', 'device-A', credential)).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    db.setConnectionStateForTesting(false,null);
    await expect(db.completeCommandInDb('cmd-F', 'completed', '', '', 0, 'device-A', credential))
      .rejects.toThrow('COMMAND_CREDENTIAL_DATABASE_UNAVAILABLE');
  });
});

describe('Phase O command mutation credential fence',()=>{
  it('denies revoked, rotated, foreign and missing credential proof before queue mutation',async()=>{
    process.env.NODE_ENV='production';
    const owner={id:'device-A',tenant_id:'tenant-A',device_token_hash:credential.tokenHash,agent_token_revoked:0};
    for(const changed of [{agent_token_revoked:1},{device_token_hash:'b'.repeat(64)},{tenant_id:'other'}]){
      const mutate=vi.fn(async()=>[{affectedRows:1},[]]);
      const {pool,conn}=transactionPool(mutate,{...owner,...changed});
      db.setConnectionStateForTesting(true,pool);
      expect(await db.markCommandPickedUp('cmd-A','device-A',credential)).toBe(false);
      expect(await db.completeCommandInDb('cmd-A','completed','','',0,'device-A',credential)).toBe(false);
      expect(mutate).not.toHaveBeenCalled();
      expect(conn.rollback).toHaveBeenCalledTimes(2);
    }
    const {pool,conn}=transactionPool(async()=>[{affectedRows:1},[]],owner);
    db.setConnectionStateForTesting(true,pool);
    expect(await db.markCommandPickedUp('cmd-A','device-A')).toBe(false);
    expect(conn.query).not.toHaveBeenCalled();
    expect(await db.markCommandPickedUp('cmd-A','device-A',credential)).toBe(true);
    expect(conn.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
});
