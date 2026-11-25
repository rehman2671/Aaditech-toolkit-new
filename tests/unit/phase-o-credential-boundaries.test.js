import {describe,it,expect,vi,afterEach} from 'vitest';
import * as db from '../../db.js';
import {isCredentialDeviceId,credentialDbCount,validateDeviceRevocationRequest,validatePendingCommandReconciliation,classifyDeviceCredentialRecovery} from '../../enrollment-security.js';
const id='00000000-0000-0000-0000-000000000123';
const principal={id:'admin-id',tenant_id:'tenant-a',role:'SUPER_ADMIN',username:'admin'};
const rev={confirm_device_id:id,reason_code:'COMPROMISED'};
const rec={confirm_device_id:id,action:'CANCEL_NEVER_CLAIMED_PENDING'};
const prior=process.env.NODE_ENV,originalPool=db.getPool(),originalConnected=db.isMysqlConnected();
afterEach(()=>{
 db.setConnectionStateForTesting(originalConnected,originalPool);
 if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;
});
describe('Credential authority scalar and request boundaries',()=>{
 for(const [i,value] of [null,undefined,0,true,{},[],{toString:()=>id},id+'\n',id+'\r',' '+id,id+' ',id.slice(1),'HOSTNAME','00000000-0000-0000-0000-00000000012g'].entries())
  it('refuses malformed immutable identifier '+i,async()=>{
   expect(isCredentialDeviceId(value)).toBe(false);
   expect(validateDeviceRevocationRequest(value,{...rev,confirm_device_id:value})).toBeNull();
   expect(validatePendingCommandReconciliation(value,{...rec,confirm_device_id:value})).toBeNull();
   const query=vi.fn(),getConnection=vi.fn();db.setConnectionStateForTesting(true,{query,getConnection});
   await expect(db.revokeDeviceCredential({principal,deviceId:value,reasonCode:'COMPROMISED'})).rejects.toThrow('DEVICE_REVOCATION_INVALID');
   await expect(db.reconcileRevokedDevicePendingCommands({principal,deviceId:value,action:rec.action})).rejects.toThrow('DEVICE_RECONCILIATION_INVALID');
   await expect(db.getDeviceCredentialRecoveryPreflight({principal,deviceId:value})).rejects.toThrow('DEVICE_RECOVERY_PREFLIGHT_INVALID');
   expect(query).not.toHaveBeenCalled();expect(getConnection).not.toHaveBeenCalled();
  });
 for(const [i,value] of [null,undefined,true,false,{},[],[1],-1,1.5,NaN,Infinity,'',' ','01','1\n','1e0','0x1','-0','9007199254740992','0'.repeat(17)].entries())
  it('refuses ambiguous database count '+i,()=>{
   expect(credentialDbCount(value)).toBeNull();
   const v=classifyDeviceCredentialRecovery({device_token_hash:'a'.repeat(64),agent_token_revoked:1,current_hash_matches:value,outstanding_commands:value});
   expect(v).toMatchObject({credential_state:'UNVERIFIED',outstanding_commands:null,replacement_allowed:false});
   expect(v.blockers).toContain('STATE_UNVERIFIED');
  });
 for(const [value,expected] of [[0,0],[1,1],['0',0],['1',1],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER],['9007199254740991',Number.MAX_SAFE_INTEGER]])
  it('preserves valid database count '+String(value)+' '+typeof value,()=>expect(credentialDbCount(value)).toBe(expected));
 for(const [i,mutate] of [x=>({...x,extra:true}),x=>Object.assign(Object.create({inherited:true}),x),x=>Object.assign(Object.create(null),x),x=>({...x,[Symbol('extra')]:true}),x=>Object.assign([],x),x=>({confirm_device_id:id}),()=>null].entries())
  it('rejects ambiguous request shape '+i,()=>{
   expect(validateDeviceRevocationRequest(id,mutate(rev))).toBeNull();
   expect(validatePendingCommandReconciliation(id,mutate(rec))).toBeNull();
  });
 for(const [i,hash] of ['a'.repeat(64)+'\n','a'.repeat(64)+'\r','A'.repeat(64),'a'.repeat(63),{},[],{toString(){throw Error('coercion')}}].entries())
  it('does not coerce or query malformed deployed credential hash '+i,async()=>{
   process.env.NODE_ENV='production';const query=vi.fn();db.setConnectionStateForTesting(true,{query});
   expect(await db.getDeviceByTokenHash(hash)).toBeNull();expect(query).not.toHaveBeenCalled();
  });
 for(const [i,flag] of [null,undefined,2,-1,'false','00',{},[]].entries())
  it('rolls back ambiguous revocation state '+i,async()=>{
   const c={beginTransaction:vi.fn(async()=>{}),query:vi.fn(async()=>[[{id,tenant_id:'tenant-a',agent_token_revoked:flag}]]),rollback:vi.fn(async()=>{}),commit:vi.fn(),release:vi.fn()};
   db.setConnectionStateForTesting(true,{getConnection:async()=>c});
   await expect(db.revokeDeviceCredential({principal,deviceId:id,reasonCode:'COMPROMISED'})).rejects.toThrow('DEVICE_REVOCATION_STATE_UNVERIFIED');
   expect(c.query).toHaveBeenCalledTimes(1);expect(c.rollback).toHaveBeenCalledTimes(1);expect(c.commit).not.toHaveBeenCalled();expect(c.release).toHaveBeenCalledTimes(1);
  });
 it('accepts explicit request fields without authorizing replacement',()=>{
  expect(validateDeviceRevocationRequest(id,rev)).toEqual({deviceId:id,reasonCode:'COMPROMISED'});
  expect(validatePendingCommandReconciliation(id,rec)).toEqual({deviceId:id,action:rec.action});
  expect(classifyDeviceCredentialRecovery({device_token_hash:'a'.repeat(64)+'\n',current_hash_matches:1,outstanding_commands:0,agent_token_revoked:1}).credential_state).toBe('INVALID_CURRENT');
 });
});
