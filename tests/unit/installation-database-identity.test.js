import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('../../scripts/installation-identity-store-posix.mjs',()=>({inspectLocalInstallationIdentity:vi.fn(async()=>({installation_id:'id',identity_sha256:'pin'}))}));
import {inspectLocalInstallationIdentity} from '../../scripts/installation-identity-store-posix.mjs';
import {identityPolicy,assertDatabaseIdentity,bindFreshDatabaseIdentity,boundReportPool} from '../../installation-database-identity.js';
import {registerBoundEmployeeRoutes} from '../../troubleshooting-employee-routes.js';
const row={singleton_id:1,installation_id:'id',identity_sha256:'pin'};
function conn({rows=[row],occupied=false}={}){
 let stored=rows;return {beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(async()=>{}),release:vi.fn(),destroy:vi.fn(),
 query:vi.fn(async sql=>[sql.includes('installation_database_identity')?stored:occupied?[{occupied:1}]:[]]),
 execute:vi.fn(async()=>{stored=[row];return [{affectedRows:1}]})};
}
beforeEach(()=>{vi.clearAllMocks()});
describe('installation-bound reporting',()=>{
 it('requires explicit opt-in',()=>expect(()=>identityPolicy({})).toThrow());
 it('checks exact persisted singleton',async()=>{expect(await assertDatabaseIdentity(conn(),{})).toBe('id');for(const rows of [[],[row,row],[{...row,identity_sha256:'bad'}],[{...row,installation_id:'other'}]])await expect(assertDatabaseIdentity(conn({rows}),{})).rejects.toThrow()});
 it('initializes only empty device/intake DB and confirms readback',async()=>{const c=conn({rows:[]});expect(await bindFreshDatabaseIdentity(c,{},'BIND_EMPTY_DATABASE_TO_PINNED_IDENTITY_ONLY')).toMatchObject({created:true,database_binding_verified:true,production_accepted:false});expect(c.execute).toHaveBeenCalledOnce();expect(c.commit).toHaveBeenCalledOnce()});
 it('never auto-adopts occupied or mismatched databases',async()=>{for(const c of [conn({rows:[],occupied:true}),conn({rows:[{...row,installation_id:'other'}]})]){await expect(bindFreshDatabaseIdentity(c,{},'BIND_EMPTY_DATABASE_TO_PINNED_IDENTITY_ONLY')).rejects.toThrow();expect(c.execute).not.toHaveBeenCalled();expect(c.rollback).toHaveBeenCalledOnce()}});
 it('idempotently checks existing identity without update',async()=>{const c=conn();expect((await bindFreshDatabaseIdentity(c,{},'BIND_EMPTY_DATABASE_TO_PINNED_IDENTITY_ONLY')).created).toBe(false);expect(c.execute).not.toHaveBeenCalled()});
 it('checks binding under the same transaction before commit',async()=>{const c=conn();const p=boundReportPool({getConnection:async()=>c},{},'id');const wrapped=await p.getConnection();await wrapped.beginTransaction();await wrapped.commit();expect(c.query.mock.calls.map(a=>a[0])).toEqual(Array(2).fill('SELECT singleton_id,installation_id,identity_sha256 FROM installation_database_identity FOR SHARE'));expect(c.commit).toHaveBeenCalledOnce()});
 it('refuses commit when local identity is no longer valid',async()=>{const c=conn();const p=boundReportPool({getConnection:async()=>c},{},'id');const wrapped=await p.getConnection();await wrapped.beginTransaction();inspectLocalInstallationIdentity.mockRejectedValueOnce(Error('changed'));await expect(wrapped.commit()).rejects.toThrow('INSTALLATION_DATABASE_IDENTITY_UNVERIFIED');expect(c.commit).not.toHaveBeenCalled()});
 it('routes deny wrong role, cookie-only authority, client identity override and disabled adapter',async()=>{const h={};registerBoundEmployeeRoutes({post:(p,f)=>h[p]=f,get:(p,f)=>h[p]=f},{isMysqlConnected:()=>true,getPool:()=>conn()},{});
 const f=h['/api/v1/troubleshooting/employee-report'];const body={deviceId:'x',requestId:'r',categoryId:'TR-01',hazard:'NONE',consent:'SUBMIT_REPORT_ONLY'};
 const make=()=>({set(){return this},status(c){this.code=c;return this},json(){return this}});
 const req={body,query:{},headers:{authorization:'Bearer tok'},token:'tok',is:()=>true,user:{id:2,role:'MONITORING',tenant_id:'00000000-0000-4000-8000-000000000001'}};
 for(const [patch,code] of [[{user:{...req.user,role:'OPERATOR'}},403],[{headers:{}},403],[{body:{...body,installationId:'x'}},400],[{},503]]){const res=make();await f({...req,...patch},res);expect(res.code).toBe(code)}
 });
});

it('refuses a changed local identity during the database read',async()=>{inspectLocalInstallationIdentity.mockResolvedValueOnce({installation_id:'id',identity_sha256:'pin'}).mockResolvedValueOnce({installation_id:'other',identity_sha256:'pin'});await expect(assertDatabaseIdentity(conn(),{})).rejects.toThrow()});
it('refuses business queries and commits outside verified transaction',async()=>{const c=conn(),w=await boundReportPool({getConnection:async()=>c},{},'id').getConnection();expect(()=>w.query('SELECT 1')).toThrow();await expect(w.commit()).rejects.toThrow();expect(c.query).not.toHaveBeenCalled();w.release();expect(c.release).toHaveBeenCalledOnce()});
it('discards an unfinished verified transaction instead of returning it to the pool',async()=>{const c=conn(),w=await boundReportPool({getConnection:async()=>c},{},'id').getConnection();await w.beginTransaction();w.release();expect(c.destroy).toHaveBeenCalledOnce();expect(c.release).not.toHaveBeenCalled()});
it('allows a verified transaction and rejects queries after commit',async()=>{const c=conn(),w=await boundReportPool({getConnection:async()=>c},{},'id').getConnection();await w.beginTransaction();await w.query('SELECT 1');await w.commit();expect(()=>w.query('SELECT 2')).toThrow();w.release();expect(c.release).toHaveBeenCalledOnce()});
it('discards ambiguous commit even after rollback returns',async()=>{const c=conn(),w=await boundReportPool({getConnection:async()=>c},{},'id').getConnection();await w.beginTransaction();c.commit.mockRejectedValueOnce(Error('lost receipt'));await expect(w.commit()).rejects.toThrow();await w.rollback();w.release();expect(c.destroy).toHaveBeenCalledOnce();expect(c.release).not.toHaveBeenCalled()});
it('discards ambiguous fresh binding commit',async()=>{const c=conn({rows:[]});c.commit.mockRejectedValueOnce(Error('lost receipt'));await expect(bindFreshDatabaseIdentity(c,{},'BIND_EMPTY_DATABASE_TO_PINNED_IDENTITY_ONLY')).rejects.toThrow();expect(c.destroy).toHaveBeenCalledOnce()});
