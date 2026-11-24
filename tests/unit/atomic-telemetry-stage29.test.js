import { afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '../../db.js';
import { telemetryIngestSchema } from '../../validation.js';
import fs from 'node:fs';
import { appUsageCredentialCacheKey } from '../../telemetry-security.js';

const mode=process.env.NODE_ENV;
afterEach(()=>{
  db.setConnectionStateForTesting(false,null);
  if(mode===undefined)delete process.env.NODE_ENV;
  else process.env.NODE_ENV=mode;
});
describe('N29 atomic authenticated telemetry contract',()=>{
  it('refuses unpersisted batch ACKs in production and demo fallback',async()=>{
    db.setConnectionStateForTesting(false,null);
    await expect(db.ingestTelemetryBatchOnce({
      tenant_id:'t',device_id:'d',batch_id:'abcd1234',request_hash:'a'.repeat(64)
    })).rejects.toThrow('TELEMETRY_BATCH_MYSQL_REQUIRED');
    await expect(db.ingestTelemetryBatchOnce({
      tenant_id:'t',device_id:'d',batch_id:'bad id',request_hash:'a'.repeat(64)
    })).rejects.toThrow('TELEMETRY_BATCH_INVALID');
  });
  it('validates only safe optional batch IDs; old clients remain compatible',()=>{
    expect(telemetryIngestSchema.safeParse({hostname:'LAB'}).success).toBe(true);
    expect(telemetryIngestSchema.safeParse({hostname:'LAB',batch_id:'0123456789abcdef0123456789abcdef',events:[]}).success).toBe(true);
    for(const key of ['', 'contains space', 'x'.repeat(65), null, 25]){
      expect(telemetryIngestSchema.safeParse({hostname:'LAB',batch_id:key}).success).toBe(false);
    }
  });
  it('canonical agent persists stable JSON and rejects missing batch ACKs',()=>{
    const code=fs.readFileSync(new URL('../../Enterprise/agent/Agent-Collect.ps1',import.meta.url),'utf8');
    expect(code).toContain('CREATE TABLE IF NOT EXISTS telemetry_outbox');
    expect(code).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_pending');
    expect(code).toContain('SELECT batch_id, body_json, event_ids FROM telemetry_outbox');
    expect(code).toContain("INSERT INTO telemetry_outbox (batch_id, body_json, event_ids)");
    expect(code).toContain('[string]$resp.batch_id -cne $batchId');
    expect(code).toContain('UPDATE telemetry_outbox SET status=');
  });
});

describe('Phase O durable telemetry credential fence',()=>{
  const batch={tenant_id:'tenant-a',device_id:'device-a',batch_id:'fixture-batch',request_hash:'a'.repeat(64)};
  const credential={tokenHash:'b'.repeat(64)};
  const owner={id:batch.device_id,tenant_id:batch.tenant_id,device_token_hash:credential.tokenHash,agent_token_revoked:0};
  function fixture(rows) {
    const conn={beginTransaction:vi.fn(async()=>{}),commit:vi.fn(async()=>{}),
      rollback:vi.fn(async()=>{}),release:vi.fn(),
      query:vi.fn(async(sql)=>{
        if(sql.startsWith('SELECT id, tenant_id, device_token_hash')) return [rows];
        throw new Error('unexpected write');
      })};
    db.setConnectionStateForTesting(true,{getConnection:async()=>conn});
    return conn;
  }
  it('rejects stale and revoked credentials before batch receipt mutation',async()=>{
    process.env.NODE_ENV='production';
    for(const row of [{...owner,agent_token_revoked:1},{...owner,agent_token_revoked:null},{...owner,device_token_hash:'c'.repeat(64)}]){
      const c=fixture([row]);
      await expect(db.ingestTelemetryBatchOnce(batch,credential)).rejects.toThrow('TELEMETRY_CREDENTIAL_CHANGED');
      expect(c.query).toHaveBeenCalledTimes(1);
      expect(c.query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(c.rollback).toHaveBeenCalledTimes(1);
      expect(c.commit).not.toHaveBeenCalled();
      expect(c.release).toHaveBeenCalledTimes(1);
    }
  });
  it('requires deployed credentials and exact persisted tenant ownership',async()=>{
    process.env.NODE_ENV='production';
    const c=fixture([owner]);
    await expect(db.ingestTelemetryBatchOnce(batch)).rejects.toThrow('TELEMETRY_CREDENTIAL_CHANGED');
    expect(c.query).toHaveBeenCalledTimes(1);
    for(const rows of [[],[owner,owner],[{...owner,tenant_id:'foreign'}]]){
      const f=fixture(rows);
      await expect(db.ingestTelemetryBatchOnce(batch,credential)).rejects.toThrow('TELEMETRY_DEVICE_OWNER_MISMATCH');
      expect(f.query).toHaveBeenCalledTimes(1);
    }
  });
});

describe('Phase O app usage credential-generation isolation',()=>{
  const base={tenantId:'tenant-a',deviceId:'device-a',tokenHash:'a'.repeat(64),revoked:0};
  it('uses an opaque namespace that changes across tenants, devices and token generations',()=>{
    const key=appUsageCredentialCacheKey(base);
    expect(key).toMatch(/^app_usage:v2:[a-f0-9]{64}$/);
    expect(key).not.toContain(base.tokenHash);
    for(const patch of [{tenantId:'tenant-b'},{deviceId:'device-b'},{tokenHash:'b'.repeat(64)}]){
      expect(appUsageCredentialCacheKey({...base,...patch})).not.toBe(key);
    }
    for(const patch of [{revoked:1},{revoked:null},{revoked:undefined},{tokenHash:'bad'},{tenantId:''}]){
      expect(appUsageCredentialCacheKey({...base,...patch})).toBeNull();
    }
  });
  it('re-resolves the current scoped DB row and rejects revoked or ambiguous authority',async()=>{
    const row={id:base.deviceId,tenant_id:base.tenantId,device_token_hash:base.tokenHash,agent_token_revoked:0,hash_matches:1};
    const query=vi.fn(async()=>[[row]]);
    db.setConnectionStateForTesting(true,{query});
    const resolve=()=>db.getActiveDeviceAppUsageCacheKey(base.deviceId,base.tenantId);
    expect(await resolve()).toBe(appUsageCredentialCacheKey(base));
    expect(query.mock.calls[0][0]).toContain('d.tenant_id = ?');
    expect(query.mock.calls[0][1]).toEqual([base.deviceId,base.tenantId]);
    query.mockResolvedValueOnce([[{...row,device_token_hash:'b'.repeat(64)}]]);
    expect(await resolve()).toBe(appUsageCredentialCacheKey({...base,tokenHash:'b'.repeat(64)}));
    for(const rows of [[],[row,row],[{...row,agent_token_revoked:1}],
      [{...row,agent_token_revoked:null}],[{...row,hash_matches:2}],[{...row,tenant_id:'foreign'}]]){
      query.mockResolvedValueOnce([rows]);
      expect(await resolve()).toBeNull();
    }
    db.setConnectionStateForTesting(false,null);
    await expect(resolve()).rejects.toThrow('APP_USAGE_DATABASE_UNAVAILABLE');
  });
  it('legacy standalone sends and checks a keyed receipt without installing response credentials',()=>{
    const legacy=fs.readFileSync(new URL('../../Enterprise/agent/Aaditech-Agent.ps1',import.meta.url),'utf8');
    expect(legacy).toContain('batch_id        = $batchId');
    expect(legacy).toContain('[string]$response.batch_id -cne $batchId');
    expect(legacy).not.toContain('$response.new_device_token');
  });
});


describe('Phase O persistent app usage snapshot',()=>{
  const device='usage-device',tenant='usage-tenant',tokenHash='b'.repeat(64);
  const timestamp=new Date('2026-01-01T12:00:00.000Z');
  const row={device_id:device,tenant_id:tenant,payload_json:'[{"name":"CI app","seconds":12}]',recorded_at:timestamp};
  const batch={tenant_id:tenant,device_id:device,batch_id:'usage-batch',request_hash:'a'.repeat(64),
    device_updates:{status:'online',cpu_usage:'12.0%'},app_usage:[{name:'CI app',seconds:12}]};
  const credential={tokenHash};
  it('reads exactly one scoped, current, fresh snapshot and distinguishes empty from absent',async()=>{
    const query=vi.fn(async()=>[[row]]);
    db.setConnectionStateForTesting(true,{query});
    expect(await db.getCurrentAppUsageSnapshot(device,tenant)).toEqual({
      app_usage:batch.app_usage,recorded_at:timestamp.toISOString()
    });
    const [sql,args]=query.mock.calls[0];
    expect(args).toEqual([device,tenant]);
    for(const predicate of ['d.tenant_id=s.tenant_id','d.agent_token_revoked=0','COUNT(*)','credential_fingerprint','SHA2','INTERVAL 15 MINUTE','AND NOW(3)'])expect(sql).toContain(predicate);
    query.mockResolvedValueOnce([[{...row,payload_json:[]}]]);
    expect(await db.getCurrentAppUsageSnapshot(device,tenant)).toEqual({app_usage:[],recorded_at:timestamp.toISOString()});
    query.mockResolvedValueOnce([[]]);
    expect(await db.getCurrentAppUsageSnapshot(device,tenant)).toBeNull();
    expect(await db.getCurrentAppUsageSnapshot('',tenant)).toBeNull();
  });
  it('denies corrupted, ambiguous or mismatched rows and unavailable persistence',async()=>{
    const query=vi.fn();
    db.setConnectionStateForTesting(true,{query});
    for(const rows of [null,[row,row],[{...row,tenant_id:'other'}],[{...row,device_id:'other'}],
      [{...row,payload_json:'not json'}],[{...row,payload_json:{}}],
      [{...row,payload_json:[null]}],[{...row,payload_json:[[]]}],
      [{...row,payload_json:['invalid']}],[{...row,payload_json:Array.from({length:101},()=>({}))}],
      [{...row,recorded_at:null}],[{...row,recorded_at:'invalid date'}]]){
      query.mockResolvedValueOnce([rows]);
      expect(await db.getCurrentAppUsageSnapshot(device,tenant)).toBeNull();
    }
    db.setConnectionStateForTesting(false,null);
    await expect(db.getCurrentAppUsageSnapshot(device,tenant)).rejects.toThrow('APP_USAGE_DATABASE_UNAVAILABLE');
  });
  function transaction({duplicate=false,snapshotFails=false,deviceFails=false,ownerPatch={}}={}){
    let nonce;
    const owner={id:device,tenant_id:tenant,device_token_hash:tokenHash,agent_token_revoked:0,...ownerPatch};
    const conn={beginTransaction:vi.fn(async()=>{}),commit:vi.fn(async()=>{}),
      rollback:vi.fn(async()=>{}),release:vi.fn(),
      query:vi.fn(async(sql,params)=>{
        if(sql.startsWith('SELECT id, tenant_id, device_token_hash'))return [[owner]];
        if(sql.startsWith('INSERT INTO telemetry_batches')){nonce=params[4];return [{affectedRows:1}];}
        if(sql.startsWith('SELECT request_hash, insert_nonce'))return [[{
          request_hash:batch.request_hash,insert_nonce:duplicate?'prior-nonce':nonce,
          accepted_count:0,recorded_at:timestamp
        }]];
        if(sql.startsWith('INSERT INTO device_app_usage_snapshots')){
          if(snapshotFails)throw Error('snapshot write failed');
          return [{affectedRows:1}];
        }
        if(sql.startsWith('UPDATE devices SET')){
          if(deviceFails)throw Error('device write failed');
          return [{affectedRows:1}];
        }
        throw Error('unexpected query '+sql);
      })};
    db.setConnectionStateForTesting(true,{getConnection:async()=>conn});
    return conn;
  }
  it('persists bounded evidence before the same transaction commits, never stores a raw token hash',async()=>{
    const c=transaction();
    const result=await db.ingestTelemetryBatchOnce(batch,credential);
    expect(result).toEqual({duplicate:false,accepted:0,recorded_at:timestamp,batch_id:batch.batch_id});
    const write=c.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO device_app_usage_snapshots'));
    expect(write[1]).toEqual([device,tenant,expect.stringMatching(/^[a-f0-9]{64}$/),JSON.stringify(batch.app_usage),timestamp]);
    expect(write[1][2]).not.toBe(tokenHash);
    expect(c.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(c.commit).toHaveBeenCalledTimes(1);
    expect(c.rollback).not.toHaveBeenCalled();
    expect(c.release).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite a snapshot or refresh liveness when a receipt is replayed',async()=>{
    const c=transaction({duplicate:true});
    expect((await db.ingestTelemetryBatchOnce(batch,credential)).duplicate).toBe(true);
    expect(c.query).toHaveBeenCalledTimes(3);
    expect(c.commit).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed or oversized evidence and rolls back the entire batch',async()=>{
    for(const value of [null,{},[null],[[]],['x'],Array.from({length:101},()=>({})),[{name:'x'.repeat(65537)}]]){
      const c=transaction();
      await expect(db.ingestTelemetryBatchOnce({...batch,app_usage:value},credential)).rejects.toThrow('TELEMETRY_APP_USAGE_INVALID');
      expect(c.rollback).toHaveBeenCalledTimes(1);
      expect(c.commit).not.toHaveBeenCalled();
    }
    for(const [config,message] of [[{snapshotFails:true},'snapshot write failed'],[{deviceFails:true},'device write failed']]){
      const c=transaction(config);
      await expect(db.ingestTelemetryBatchOnce(batch,credential)).rejects.toThrow(message);
      expect(c.rollback).toHaveBeenCalledTimes(1);
      expect(c.commit).not.toHaveBeenCalled();
      expect(c.release).toHaveBeenCalledTimes(1);
    }
  });
  it('requires an active valid credential even for explicit app usage in a test fixture',async()=>{
    for(const ownerPatch of [{agent_token_revoked:1},{device_token_hash:null}]){
      const c=transaction({ownerPatch});
      await expect(db.ingestTelemetryBatchOnce(batch)).rejects.toThrow('TELEMETRY_CREDENTIAL_CHANGED');
      expect(c.rollback).toHaveBeenCalledTimes(1);
      expect(c.commit).not.toHaveBeenCalled();
    }
    const c=transaction();
    expect((await db.ingestTelemetryBatchOnce({...batch,app_usage:[]},credential)).duplicate).toBe(false);
    expect(c.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO device_app_usage_snapshots'))[1][3]).toBe('[]');
    const absent=transaction();
    const {app_usage:ignored,...noUsage}=batch;
    await db.ingestTelemetryBatchOnce(noUsage,credential);
    expect(absent.query.mock.calls.some(([sql])=>sql.includes('device_app_usage_snapshots'))).toBe(false);
  });
});
