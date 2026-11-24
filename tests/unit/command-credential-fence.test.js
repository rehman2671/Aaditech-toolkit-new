import { describe, it, expect, vi, afterEach } from 'vitest';
import * as db from '../../db.js';

const owner = 'device-a', command = 'command-a';
const credential = {tenantId:'tenant-a',tokenHash:'a'.repeat(64)};
const originalPool = db.getPool(), originalConnected = db.isMysqlConnected();
afterEach(() => db.setConnectionStateForTesting(originalConnected,originalPool));
const active = {id:owner,tenant_id:credential.tenantId,device_token_hash:credential.tokenHash,agent_token_revoked:0};
function setup(rows=[active],writeFails=false) {
  const conn={beginTransaction:vi.fn(async()=>{}),commit:vi.fn(async()=>{}),
    rollback:vi.fn(async()=>{}),release:vi.fn(),
    query:vi.fn(async(sql)=>{
      if(sql.startsWith('SELECT')) return [rows];
      if(writeFails) throw new Error('write failed');
      return [{affectedRows:1}];
    })};
  db.setConnectionStateForTesting(true,{getConnection:async()=>conn});
  return conn;
}
const enqueue=()=>db.queueCommandInDb({id:command,device_id:owner,kind:'run-script'},credential);
const claim=()=>db.markCommandPickedUp(command,owner,credential);
const complete=()=>db.completeCommandInDb(command,'completed','ok','',0,owner,credential);
describe('credential-bound command mutation transaction',()=>{
  it('locks the same device row before a claim or terminal result and commits once',async()=>{
    for(const mutation of [enqueue,claim,complete]){
      const c=setup();
      expect(await mutation()).toBe(true);
      expect(c.query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(c.query.mock.calls[0][1]).toEqual([owner,credential.tenantId]);
      expect(c.query.mock.calls[1][0]).toMatch(/(?:INSERT INTO|UPDATE) command_queue/);
      expect(c.commit).toHaveBeenCalledTimes(1);
      expect(c.rollback).not.toHaveBeenCalled();
      expect(c.release).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects revoked, rotated, foreign, missing, duplicate or unverified current state before a command write',async()=>{
    for(const rows of [[],[active,active],[{...active,agent_token_revoked:1}],
      [{...active,agent_token_revoked:null}],[{...active,device_token_hash:'b'.repeat(64)}],
      [{...active,tenant_id:'tenant-b'}]]){
      for(const mutation of [enqueue,claim,complete]){
        const c=setup(rows);
        await expect(mutation()).rejects.toThrow('COMMAND_CREDENTIAL_CHANGED');
        expect(c.query).toHaveBeenCalledTimes(1);
        expect(c.commit).not.toHaveBeenCalled();
        expect(c.rollback).toHaveBeenCalledTimes(1);
        expect(c.release).toHaveBeenCalledTimes(1);
      }
    }
  });
  it('rolls back a failed mutation and rejects unavailable persistent storage',async()=>{
    const c=setup([active],true);
    await expect(claim()).rejects.toThrow('write failed');
    expect(c.rollback).toHaveBeenCalledTimes(1);
    expect(c.commit).not.toHaveBeenCalled();
    db.setConnectionStateForTesting(false,null);
    await expect(claim()).rejects.toThrow('COMMAND_CREDENTIAL_DATABASE_UNAVAILABLE');
  });
});


describe('credential-bound heartbeat transaction',()=>{
  const heartbeat=()=>db.recordCredentialBoundHeartbeat(owner,credential);
  it('locks the current device before writing status and last-seen',async()=>{
    const c=setup();
    expect(await heartbeat()).toBe(true);
    expect(c.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(c.query.mock.calls[0][1]).toEqual([owner,credential.tenantId]);
    expect(c.query.mock.calls[1][0]).toContain("UPDATE devices SET status = 'online', last_seen_at = NOW(3)");
    expect(c.query.mock.calls[1][1]).toEqual([owner,credential.tenantId]);
    expect(c.commit).toHaveBeenCalledTimes(1);
  });
  it('denies stale, revoked, foreign and missing proof without updating last-seen',async()=>{
    for(const rows of [[],[active,active],[{...active,agent_token_revoked:1}],
      [{...active,agent_token_revoked:null}],[{...active,device_token_hash:'b'.repeat(64)}],
      [{...active,tenant_id:'tenant-b'}]]) {
      const c=setup(rows);
      await expect(heartbeat()).rejects.toThrow('COMMAND_CREDENTIAL_CHANGED');
      expect(c.query).toHaveBeenCalledTimes(1);
      expect(c.rollback).toHaveBeenCalledTimes(1);
      expect(c.commit).not.toHaveBeenCalled();
    }
    const c=setup();
    await expect(db.recordCredentialBoundHeartbeat(owner)).rejects.toThrow('COMMAND_CREDENTIAL_CHANGED');
    expect(c.query).not.toHaveBeenCalled();
  });
  it('fails closed on write failure and unavailable database',async()=>{
    const c=setup([active],true);
    await expect(heartbeat()).rejects.toThrow('write failed');
    expect(c.rollback).toHaveBeenCalledTimes(1);
    db.setConnectionStateForTesting(false,null);
    await expect(heartbeat()).rejects.toThrow('COMMAND_CREDENTIAL_DATABASE_UNAVAILABLE');
  });
});
