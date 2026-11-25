import {it,expect,vi} from 'vitest';
import {inspectServerConfiguration,registerServerConfigurationRoutes} from '../../server-configuration-routes.js';
it('returns bounded actual observations and never emits secrets',async()=>{
 const db={isMysqlConnected:()=>true,getPool:()=>({query:vi.fn(async q=>q.startsWith('SELECT 1')?[[{reachable:1}]]:[[{version:'022'}]])})};
 const r=await inspectServerConfiguration(db,{SERVER_HOST:'server.internal',DB_PASSWORD:'secret',AADITECH_BOUND_REPORTS:'disabled'});
 expect(r).toMatchObject({database_reachable:true,latest_recorded_migration:'022',configured_server_host:'server.internal',report_identity_state:'DISABLED',production_accepted:false});
 expect(JSON.stringify(r)).not.toContain('secret');
});
it('does not report healthy database or identity on failed observations',async()=>{
 const r=await inspectServerConfiguration({isMysqlConnected:()=>true,getPool:()=>({query:async()=>{throw Error('private')}})},{SERVER_HOST:'https://invalid/path',AADITECH_BOUND_REPORTS:'enabled'});
 expect(r).toMatchObject({database_reachable:false,latest_recorded_migration:null,configured_server_host:null,report_identity_state:'UNVERIFIED'});
});
it('denies global status without configured platform owner and explicit bearer',async()=>{
 let f;registerServerConfigurationRoutes({get:(p,handler)=>{f=handler}},{},{NODE_ENV:'staging'});
 const res={set(){return this},status(n){this.n=n;return this},json(){return this}};
 await f({user:{id:1,role:'SUPER_ADMIN',tenant_id:'00000000-0000-4000-8000-000000000001'},headers:{authorization:'Bearer x'},token:'x',query:{}},res);
 expect(res.n).toBe(403);
});
