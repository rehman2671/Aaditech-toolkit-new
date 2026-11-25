import {describe,it,expect,vi} from 'vitest';
import {withSchemaMigrationLock as lock} from '../../schema-migration-lock.js';
function fixture(acquire=1,release=1){
 const c={query:vi.fn(async sql=>{
  if(sql.includes('GET_LOCK')){if(acquire instanceof Error)throw acquire;return [[{locked:acquire}]];}
  if(sql.includes('RELEASE_LOCK')){if(release instanceof Error)throw release;return [[{released:release}]];}
  return [[]];
 }),release:vi.fn(),destroy:vi.fn()};
 return {c,pool:{getConnection:vi.fn(async()=>c),query:vi.fn()}};
}
describe('session-owned schema migration lock',()=>{
 it('acquires, executes and releases on one connection',async()=>{
  const f=fixture();expect(await lock(f.pool,async c=>{expect(c).toBe(f.c);await c.query('DDL');return 42})).toBe(42);
  expect(f.c.query.mock.calls.map(([q])=>q)).toEqual(["SELECT GET_LOCK('itk_schema_migrations_lock', 15) AS locked",'DDL',"SELECT RELEASE_LOCK('itk_schema_migrations_lock') AS released"]);
  expect(f.pool.query).not.toHaveBeenCalled();expect(f.c.release).toHaveBeenCalledOnce();expect(f.c.destroy).not.toHaveBeenCalled();
 });
 it('never runs work on timeout, null, or acquisition failure',async()=>{
  for(const a of [0,null,new Error('offline')]){
   const f=fixture(a),work=vi.fn();await expect(lock(f.pool,work)).rejects.toThrow();
   expect(work).not.toHaveBeenCalled();expect(f.c.destroy).toHaveBeenCalledOnce();expect(f.c.release).not.toHaveBeenCalled();
  }
 });
 it('preserves work error, discards uncertain sessions and fails closed after successful work',async()=>{
  const f=fixture();await expect(lock(f.pool,()=>{throw Error('DDL_FAILED')})).rejects.toThrow('DDL_FAILED');expect(f.c.release).toHaveBeenCalledOnce();
  for(const a of [0,null,new Error('offline')]){
   const x=fixture(1,a);await expect(lock(x.pool,()=>42)).rejects.toThrow('SCHEMA_MIGRATION_LOCK_RELEASE_UNCONFIRMED');expect(x.c.destroy).toHaveBeenCalledOnce();
  }
 });
});
