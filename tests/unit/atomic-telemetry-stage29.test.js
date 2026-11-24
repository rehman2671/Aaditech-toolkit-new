import { afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '../../db.js';
import { telemetryIngestSchema } from '../../validation.js';
import fs from 'node:fs';

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
