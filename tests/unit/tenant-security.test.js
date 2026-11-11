import {describe,it,expect} from 'vitest';
import {DEFAULT_TENANT_ID,ownsTenant,filterTenantRecords,publicDeviceRecord,
  isBoundUserSession,deviceOwnsCommand} from '../../tenant-security.js';

const tenant2='9821a6ca-3131-4d56-8b33-6d3f0f003222';
const admin={id:1,username:'admin',tenant_id:DEFAULT_TENANT_ID,role:'SUPER_ADMIN'};

describe('Phase K — tenant and device trust invariants',()=>{
  it('SUPER_ADMIN is tenant scoped and missing tenant denies by default',()=>{
    expect(ownsTenant(admin,{tenant_id:DEFAULT_TENANT_ID})).toBe(true);
    expect(ownsTenant(admin,{tenant_id:tenant2})).toBe(false);
    expect(ownsTenant(admin,{id:'record-without-tenant'})).toBe(false);
    expect(ownsTenant({role:'SUPER_ADMIN'},DEFAULT_TENANT_ID)).toBe(false);
    expect(ownsTenant(null,DEFAULT_TENANT_ID)).toBe(false);
    expect(filterTenantRecords(admin,[
      {id:1,tenant_id:DEFAULT_TENANT_ID},
      {id:2,tenant_id:tenant2},{id:3}
    ])).toEqual([{id:1,tenant_id:DEFAULT_TENANT_ID}]);
  });
  it('never puts agent secrets or token hashes in public device records',()=>{
    const result=publicDeviceRecord({
      id:'dev-1',hostname:'WIN-01',tenant_id:DEFAULT_TENANT_ID,
      device_token_hash:'hash',auth_token_hash:'old',device_token_prefix:'itk_dev_',
      bootstrap_token:'bootstrap',device_token:'secret',command_signing_key:'secret'
    });
    expect(result).toEqual({id:'dev-1',hostname:'WIN-01',tenant_id:DEFAULT_TENANT_ID});
  });
  it('binds signed login to current live account ID, name, tenant and active state',()=>{
    const db={...admin,active:true,status:'ACTIVE'};
    expect(isBoundUserSession(admin,db)).toBe(true);
    expect(isBoundUserSession(admin,{...db,active:false})).toBe(false);
    expect(isBoundUserSession(admin,{...db,status:'DISABLED'})).toBe(false);
    expect(isBoundUserSession(admin,{...db,tenant_id:tenant2})).toBe(false);
    expect(isBoundUserSession(admin,{...db,id:200})).toBe(false);
    expect(isBoundUserSession(admin,{...db,username:'renamed'})).toBe(false);
    expect(isBoundUserSession(admin,null)).toBe(false);
  });
  it('a device cannot submit another device’s command result',()=>{
    const device={id:'a',hostname:'WIN-A',tenant_id:DEFAULT_TENANT_ID};
    expect(deviceOwnsCommand(device,{device_id:'a',tenant_id:DEFAULT_TENANT_ID})).toBe(true);
    expect(deviceOwnsCommand(device,{device_id:'b',tenant_id:DEFAULT_TENANT_ID})).toBe(false);
    expect(deviceOwnsCommand(device,{device_id:'a',tenant_id:tenant2})).toBe(false);
    expect(deviceOwnsCommand(null,{device_id:'a'})).toBe(false);
  });
});
