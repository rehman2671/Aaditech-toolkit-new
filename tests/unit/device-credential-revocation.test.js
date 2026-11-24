import { describe,it,expect,vi,afterEach } from 'vitest';
import * as db from '../../db.js';
import { validateDeviceRevocationRequest, classifyDeviceCredentialRecovery } from '../../enrollment-security.js';

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


describe('read-only credential recovery preflight', () => {
  const hash = 'a'.repeat(64);
  const row = { id, tenant_id: 'tenant-a', device_token_hash: hash,
    auth_token_hash: 'legacy-secret-hash', agent_token_revoked: 1,
    current_hash_matches: 1, outstanding_commands: 0 };
  it('reports only safe evidence and never authorizes replacement', () => {
    expect(classifyDeviceCredentialRecovery(row)).toEqual({
      credential_state:'CURRENT_UNIQUE', credential_revoked:true, outstanding_commands:0,
      blockers:['AUTHORIZED_RECOVERY_HANDOFF_REQUIRED'], replacement_allowed:false
    });
    const active = classifyDeviceCredentialRecovery({...row,agent_token_revoked:0,outstanding_commands:'2'});
    expect(active.blockers).toContain('REVOKE_FIRST');
    expect(active.blockers).toContain('COMMAND_RECONCILIATION_REQUIRED');
    expect(active.replacement_allowed).toBe(false);
    expect(JSON.stringify(active)).not.toContain(hash);
    for(const [patch,state] of [
      [{device_token_hash:null},'LEGACY_ONLY'],
      [{device_token_hash:null,auth_token_hash:null},'MISSING'],
      [{device_token_hash:'invalid'},'INVALID_CURRENT'],
      [{current_hash_matches:2},'AMBIGUOUS_CURRENT'],
      [{current_hash_matches:null},'UNVERIFIED']
    ]) {
      const result=classifyDeviceCredentialRecovery({...row,...patch});
      expect(result.credential_state).toBe(state);
      expect(result.blockers).toContain('CREDENTIAL_MIGRATION_REVIEW_REQUIRED');
      expect(result.replacement_allowed).toBe(false);
    }
    expect(classifyDeviceCredentialRecovery({...row,outstanding_commands:null,agent_token_revoked:null}).blockers).toContain('STATE_UNVERIFIED');
  });
  it('uses one tenant-scoped persistent read and refuses foreign or ambiguous rows',async()=>{
    const query=vi.fn(async()=>[[row]]);
    db.setConnectionStateForTesting(true,{query});
    const result=await db.getDeviceCredentialRecoveryPreflight({principal,deviceId:id});
    expect(result.device_id).toBe(id);
    expect(result.replacement_allowed).toBe(false);
    expect(JSON.stringify(result)).not.toContain(hash);
    expect(JSON.stringify(result)).not.toContain('legacy-secret-hash');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('d.tenant_id = ?');
    expect(query.mock.calls[0][0]).toContain('command_queue');
    expect(query.mock.calls[0][1]).toEqual([id,'tenant-a']);
    for(const rows of [[],[{...row,tenant_id:'tenant-b'}],[row,row]]) {
      query.mockResolvedValueOnce([rows]);
      expect(await db.getDeviceCredentialRecoveryPreflight({principal,deviceId:id})).toBeNull();
    }
    await expect(db.getDeviceCredentialRecoveryPreflight({principal:{...principal,role:'OPERATOR'},deviceId:id})).rejects.toThrow('DEVICE_RECOVERY_PREFLIGHT_INVALID');
    db.setConnectionStateForTesting(false,null);
    await expect(db.getDeviceCredentialRecoveryPreflight({principal,deviceId:id})).rejects.toThrow('DEVICE_RECOVERY_MYSQL_REQUIRED');
  });
});
