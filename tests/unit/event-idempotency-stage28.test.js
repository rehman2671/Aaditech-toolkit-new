import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { telemetryIngestSchema } from '../../validation.js';
import * as db from '../../db.js';

const savedMode = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (savedMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedMode;
});
describe('Stage N28 event retry idempotency', () => {
  it('preserves optional legacy events but rejects malformed IDs and large batches', () => {
    expect(telemetryIngestSchema.safeParse({ hostname:'PC',
      events:[{ kind:'health' }, {kind:'health',client_msg_id:'0123456789abcdef0123456789abcdef:17'}]
    }).success).toBe(true);
    for(const key of ['', 'bad key', 'x'.repeat(161), 42, null]){
      expect(telemetryIngestSchema.safeParse({hostname:'PC',events:[{client_msg_id:key}]}).success).toBe(false);
    }
    expect(telemetryIngestSchema.safeParse({hostname:'PC',events:Array.from({length:51},()=>({}))}).success).toBe(false);
  });
  it('resolves exact retry and rejects altered content with reused message ID',async()=>{
    process.env.NODE_ENV='production';
    const queries=[];let persistedHash=null;
    db.setConnectionStateForTesting(true,{query:async(sql,params=[])=>{
      queries.push({sql,params});
      if(sql.includes('ON DUPLICATE KEY UPDATE')){
        if(!persistedHash){persistedHash=params[3];return [{insertId:19,affectedRows:1},[]];}
        return [{insertId:19,affectedRows:0},[]];
      }
      if(sql.startsWith('SELECT id, event_hash'))return [[{id:19,event_hash:persistedHash}],[]];
      throw Error('Unexpected SQL: '+sql);
    }});
    const ev={tenant_id:'t-A',device_id:'d-A',hostname:'SHARED',kind:'health',payload:{free:0},client_msg_id:'q:1'};
    const first=await db.addEvent(ev),second=await db.addEvent(ev);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect(queries[0].params.slice(0,3)).toEqual(['t-A','d-A','q:1']);
    await expect(db.addEvent({...ev,payload:{free:999}})).rejects.toThrow('EVENT_IDEMPOTENCY_CONFLICT');
  });
  it('MSI worker persists queue identity instead of reusing hostname+row counter',()=>{
    const s=fs.readFileSync(new URL('../../Enterprise/agent/Agent-Collect.ps1',import.meta.url),'utf8');
    expect(s).toContain('CREATE TABLE IF NOT EXISTS queue_identity');
    expect(s).toContain('INSERT OR IGNORE INTO queue_identity');
    expect(s).toContain('function Get-QueueInstanceId {');
    expect(s).toContain('Get-QueueInstanceId } else { $null }');
    expect(s).toContain('client_msg_id = "\${queueInstanceId}:$([long]$row.id)"');
    expect(s).not.toContain('client_msg_id = "$(Get-AgentHostname):$($row.id)"');
  });
});
