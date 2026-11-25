import {describe,it,expect,vi,beforeEach} from 'vitest';
import {createHash} from 'node:crypto';
vi.mock('../../scripts/installation-identity-store-posix.mjs',()=>({inspectLocalInstallationIdentity:vi.fn(async()=>({installation_id:'fixture-id',identity_sha256:'a'.repeat(64)}))}));
import {inspectLocalInstallationIdentity as inspectIdentity} from '../../scripts/installation-identity-store-posix.mjs';
import {verifyBoundRuntimeHistory as verify,probeBoundRuntimeIdentity as probe} from '../../bound-runtime-schema.js';
const env={AADITECH_BOUND_REPORTS:'enabled',AADITECH_IDENTITY_DIRECTORY:'/fixture/id',AADITECH_INSTALLATION_ID:'fixture-id',AADITECH_IDENTITY_SHA256:'a'.repeat(64)};
const files=Array.from({length:24},(_,i)=>({name:String(i+1).padStart(3,'0')+'_fixture.sql',sql:'SELECT '+(i+1)+';'}));
const rows=files.map(f=>({version:f.name.slice(0,3),name:f.name,checksum:createHash('sha256').update(f.sql).digest('hex')}));
const identity={singleton_id:1,installation_id:env.AADITECH_INSTALLATION_ID,identity_sha256:env.AADITECH_IDENTITY_SHA256};
function connection(history=rows,ident=[identity]){
 return {query:vi.fn(async sql=>{
  if(sql==='SELECT singleton_id,installation_id,identity_sha256 FROM installation_database_identity')return [ident];
  if(sql==='SELECT version,name,checksum FROM schema_migrations')return [history];
  throw Error('unexpected SQL');
 }),release:vi.fn(),destroy:vi.fn()};
}
beforeEach(()=>{vi.clearAllMocks()});
describe('identity-bound API startup',()=>{
 it('verifies complete history without schema writes',async()=>{
  const c=connection();
  expect(await verify(c,files,env)).toEqual({applied:[],skipped:files.map(f=>f.name),status:'BOUND_RUNTIME_HISTORY_VERIFIED'});
  expect(c.query.mock.calls).toHaveLength(3);
  expect(c.query.mock.calls.every(([sql])=>sql.startsWith('SELECT '))).toBe(true);
 });
 it.each([[],rows.slice(0,23),rows.slice(1),[...rows,rows[0]],rows.map((r,i)=>i===0?{...r,checksum:'0'.repeat(64)}:r)].map(x=>[x]))('refuses incomplete or drifted history',async history=>await expect(verify(connection(history),files,env)).rejects.toThrow('BOUND_RUNTIME_DATABASE_UNVERIFIED'));
 it.each([[],[identity,identity],[{...identity,installation_id:'foreign'}],[{...identity,identity_sha256:'b'.repeat(64)}]].map(x=>[x]))('refuses missing or wrong binding before history access',async ident=>{
  const c=connection(rows,ident);await expect(verify(c,files,env)).rejects.toThrow();expect(c.query).toHaveBeenCalledTimes(1);
 });
 it('refuses truncated runtime migration files without database mutation',async()=>{const c=connection();await expect(verify(c,files.slice(0,23),env)).rejects.toThrow();expect(c.query).not.toHaveBeenCalled()});
 it('refuses missing bound opt-in',async()=>await expect(verify(connection(),files,{})).rejects.toThrow());
 it('refuses a changed local identity',async()=>{inspectIdentity.mockRejectedValueOnce(Error('changed'));await expect(verify(connection(),files,env)).rejects.toThrow()});
 it('returns a healthy bound session to pool',async()=>{const c=connection();expect(await probe({getConnection:async()=>c},env)).toBe(true);expect(c.release).toHaveBeenCalledOnce();expect(c.destroy).not.toHaveBeenCalled()});
 it('destroys an unverified session and reports unready',async()=>{const c=connection(rows,[]);expect(await probe({getConnection:async()=>c},env)).toBe(false);expect(c.destroy).toHaveBeenCalledOnce();expect(c.release).not.toHaveBeenCalled()});
 it('reports unready for failed connection acquisition',async()=>expect(await probe({getConnection:async()=>{throw Error('offline')}},env)).toBe(false));
});
