import { describe,it,expect,vi,afterEach } from 'vitest';
import * as db from '../../db.js';
import { validateDeviceRevocationRequest } from '../../enrollment-security.js';

const id='00000000-0000-0000-0000-000000000123';
const principal={id:'admin-id',tenant_id:'tenant-a',role:'SUPER_ADMIN',username:'admin'};
const input={principal,deviceId:id,reasonCode:'COMPROMISED'};
const originalPool=db.getPool(), originalConnected=db.isMysqlConnected();
afterEach(()=>db.setConnectionStateForTesting(originalConnected,originalPool));
function fixture({rows=[{id,tenant_id:'tenant-a',agent_token_revoked:0}],auditFails=false,writeFails=false}={}) {
  const conn={beginTransaction:vi.fn(async()=>{}),commit:vi.fn(async()=>{}),
    rollback:vi.fn(async()=>{}),release:vi.fn(),
    query:vi.fn(async(sql)=>{
      if(sql.startsWith('SELECT')) return [rows];
      if(sql.startsWith('UPDATE')) return [{affectedRows:writeFails?0:1}];
      if(sql.startsWith('INSERT')) {
        if(auditFails) throw new Error('audit unavailable');
        return [{affectedRows:1}];
      }
      throw new Error('unexpected query');
    })};
  db.setConnectionStateForTesting(true,{getConnection:async()=>conn});
  return conn;
}
describe('explicit durable tenant-admin device revocation',()=>{
  it('requires exact immutable device confirmation and fixed reason',()=>{
    const body={confirm_device_id:id,reason_code:'COMPROMISED'};
    expect(validateDeviceRevocationRequest(id,body)).toEqual({deviceId:id,reasonCode:'COMPROMISED'});
    for(const candidate of [{...body,reason_code:'arbitrary'},{...body,token:'secret'},{...body,confirm_device_id:'wrong'},null])
      expect(validateDeviceRevocationRequest(id,candidate)).toBeNull();
    expect(validateDeviceRevocationRequest('HOSTNAME',body)).toBeNull();
  });
  it('commits scoped revocation and audit together, without exposing hashes or changing last seen',async()=>{
    const conn=fixture();
    expect(await db.revokeDeviceCredential(input)).toEqual({status:'revoked'});
    expect(conn.query.mock.calls[0][1]).toEqual([id,'tenant-a']);
    expect(conn.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(conn.query.mock.calls[1][0]).not.toContain('last_seen_at');
    expect(conn.query.mock.calls[1][1]).toEqual([id,'tenant-a']);
    expect(conn.query.mock.calls[2][1]).toContain('DEVICE_CREDENTIAL_REVOKED');
    expect(conn.query.mock.calls[2][1]).toContain(JSON.stringify({device_id:id,reason_code:'COMPROMISED'}));
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
  it('does not mutate foreign or missing devices, and retries are read-only',async()=>{
    for(const rows of [[],[{id,tenant_id:'tenant-b',agent_token_revoked:0}]]){
      const conn=fixture({rows});
      expect(await db.revokeDeviceCredential(input)).toEqual({status:'not_found'});
      expect(conn.query).toHaveBeenCalledTimes(1);
    }
    const conn=fixture({rows:[{id,tenant_id:'tenant-a',agent_token_revoked:1}]});
    expect(await db.revokeDeviceCredential(input)).toEqual({status:'already_revoked'});
    expect(conn.query).toHaveBeenCalledTimes(1);
  });
  it('rolls back on audit or update failure and denies non-admin and offline execution',async()=>{
    for(const settings of [{auditFails:true},{writeFails:true}]){
      const conn=fixture(settings);
      await expect(db.revokeDeviceCredential(input)).rejects.toThrow();
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.release).toHaveBeenCalledTimes(1);
    }
    const conn=fixture();
    await expect(db.revokeDeviceCredential({...input,principal:{...principal,role:'OPERATOR'}})).rejects.toThrow('DEVICE_REVOCATION_INVALID');
    expect(conn.query).not.toHaveBeenCalled();
    db.setConnectionStateForTesting(false,null);
    await expect(db.revokeDeviceCredential(input)).rejects.toThrow('DEVICE_REVOCATION_MYSQL_REQUIRED');
  });
});
