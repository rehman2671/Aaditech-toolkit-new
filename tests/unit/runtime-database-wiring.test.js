import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({redis:vi.fn(),createPool:vi.fn()}));
vi.mock('ioredis',()=>({default:mocks.redis}));
vi.mock('mysql2/promise',()=>({default:{createPool:mocks.createPool}}));
let db;
const env={...process.env};
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();process.env.NODE_ENV='production';
 Object.assign(process.env,{DB_HOST:'127.0.0.1',DB_USER:'fixture',DB_PASSWORD:'fixture',DB_NAME:'fixture',DB_PORT:'3306',DB_POOL_SIZE:'20'});
 db=await import('../../db.js');
});
afterEach(async()=>{if(db){await db.stopDatabaseBackgroundWork();await db.drainDatabaseWork();await db.closeDatabaseResources();}for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env)});
function redisFixture(){
 const events=new Map();
 const client={on:vi.fn((n,f)=>{events.set(n,f)}),connect:vi.fn(async()=>{}),disconnect:vi.fn(),get:vi.fn(async()=>'{"x":1}'),set:vi.fn(async()=> 'OK'),del:vi.fn(async()=>1),keys:vi.fn(async()=>['a','b'])};
 mocks.redis.mockImplementation(function(){return client});
 return {client,emit:n=>events.get(n)?.()};
}
it('cache initialization is single-client and ready-gated',async()=>{
 const {client,emit}=redisFixture();db.initRedisClient();db.initRedisClient();expect(mocks.redis).toHaveBeenCalledTimes(1);expect(await db.cacheGet('x')).toBeNull();expect(client.get).not.toHaveBeenCalled();
 emit('ready');expect(await db.cacheGet('x')).toEqual({x:1});expect(await db.cacheSet('x',{a:1},12)).toBe(true);expect(client.set).toHaveBeenCalledWith('x','{"a":1}','EX',12);
 expect(await db.cacheDel('x')).toBe(true);expect(await db.cacheDelPattern('x:*')).toBe(true);expect(client.del).toHaveBeenLastCalledWith('a','b');
 client.keys.mockResolvedValueOnce([]);expect(await db.cacheDelPattern('missing:*')).toBe(true);
});
for(const event of ['error','end','close','reconnecting'])it('cache fallback after '+event,async()=>{
 const {client,emit}=redisFixture();db.initRedisClient();emit('ready');emit(event);expect(await db.cacheGet('x')).toBeNull();expect(await db.cacheSet('x',1)).toBe(false);expect(await db.cacheDel('x')).toBe(false);expect(await db.cacheDelPattern('x:*')).toBe(false);expect(client.set).not.toHaveBeenCalled();emit('ready');expect(await db.cacheGet('x')).toEqual({x:1});
});
it('invalid JSON and unsuccessful SET never produce success',async()=>{const {client,emit}=redisFixture();db.initRedisClient();emit('ready');client.get.mockResolvedValueOnce('broken');expect(await db.cacheGet('x')).toBeNull();client.get.mockResolvedValueOnce(null);expect(await db.cacheGet('x')).toBeNull();client.set.mockResolvedValueOnce(null);expect(await db.cacheSet('x',1)).toBe(false);client.del.mockRejectedValueOnce(Error('offline'));expect(await db.cacheDel('x')).toBe(false)});
it('late KEYS response after reconnect cannot delete new generation keys',async()=>{const {client,emit}=redisFixture();db.initRedisClient();emit('ready');let finish;client.keys.mockImplementationOnce(()=>new Promise(r=>{finish=r}));const pending=db.cacheDelPattern('x:*');emit('close');emit('ready');finish(['old']);expect(await pending).toBe(false);expect(client.del).not.toHaveBeenCalled()});
it('cache construction failure degrades safely',async()=>{mocks.redis.mockImplementation(function(){throw Error('fixture')});db.initRedisClient();expect(await db.cacheGet('x')).toBeNull()});
it('rejected cache connect and late ready after shutdown do not re-enable cache',async()=>{const {client,emit}=redisFixture();client.connect.mockRejectedValueOnce(Error('fixture'));db.initRedisClient();await Promise.resolve();expect(await db.cacheGet('x')).toBeNull();await db.stopDatabaseBackgroundWork();await db.drainDatabaseWork();await db.closeDatabaseResources();emit('ready');db.initRedisClient();expect(mocks.redis).toHaveBeenCalledTimes(1);expect(client.disconnect).toHaveBeenCalledTimes(1);expect(await db.cacheGet('x')).toBeNull()});
for(const [key,value] of [['DB_HOST',''],['DB_PORT','0'],['DB_PORT','65536'],['DB_POOL_SIZE','1'],['DB_POOL_SIZE','501']])it('reject invalid connection config '+key+' '+value,async()=>{process.env[key]=value;await expect(db.attemptConnection()).rejects.toThrow();expect(mocks.createPool).not.toHaveBeenCalled()});
it('failed pool retirement never installs a replacement',async()=>{const end=vi.fn(async()=>{throw Error('retire failed')});db.setConnectionStateForTesting(true,{end});await expect(db.attemptConnection()).rejects.toThrow('retire failed');expect(db.isMysqlConnected()).toBe(false);expect(mocks.createPool).not.toHaveBeenCalled();end.mockResolvedValue(undefined)});
it('failed candidate probe retires candidate and stays unavailable',async()=>{const candidate={on:vi.fn(),query:vi.fn(async()=>{throw Error('offline')}),end:vi.fn(async()=>{})};mocks.createPool.mockReturnValue(candidate);await expect(db.attemptConnection()).rejects.toThrow('offline');expect(candidate.end).toHaveBeenCalledTimes(1);expect(db.getPool()).toBeNull()});
it('readiness does not mark replacement pool disconnected after stale failure',async()=>{let fail;const old={query:vi.fn(()=>new Promise((_,r)=>{fail=r})),end:vi.fn(async()=>{})};const replacement={end:vi.fn(async()=>{})};db.setConnectionStateForTesting(true,old);const p=db.probeDbReadiness();db.setConnectionStateForTesting(true,replacement);fail(Error('old'));expect(await p).toBe(false);expect(db.isMysqlConnected()).toBe(true)});
it('current failed readiness marks unavailable; shutdown guards reject premature closure',async()=>{const pool={query:vi.fn(async()=>{throw Error('offline')}),end:vi.fn(async()=>{})};db.setConnectionStateForTesting(true,pool);expect(await db.probeDbReadiness()).toBe(false);expect(db.isMysqlConnected()).toBe(false);await expect(db.drainDatabaseWork()).rejects.toThrow('DATABASE_SHUTDOWN_NOT_STARTED');await expect(db.closeDatabaseResources()).rejects.toThrow('DATABASE_DRAIN_UNCONFIRMED')});
const timestamp=new Date('2026-11-26T00:00:00Z'),tokenHash='b'.repeat(64);
const batch={tenant_id:'tenant-A',device_id:'device-A',batch_id:'batch-A',request_hash:'a'.repeat(64),events:[],alerts:[]};
function recoveryPool({receipt=true,prior=false,discardFails=false,revoked=false,acquireFails=false}={}){
 const calls=[];let nonce;
 const owner={id:batch.device_id,tenant_id:batch.tenant_id,device_token_hash:tokenHash,agent_token_revoked:0};
 const first={beginTransaction:vi.fn(async()=>{}),query:vi.fn(async(sql,args)=>{calls.push(sql);if(sql.includes('FROM devices'))return [[owner]];if(sql.startsWith('INSERT INTO telemetry_batches')){nonce=args[4];return [{affectedRows:1}]};if(sql.startsWith('SELECT request_hash'))return [[{request_hash:batch.request_hash,insert_nonce:prior?'old':nonce,accepted_count:0,recorded_at:timestamp}]];return [{affectedRows:1}]}),commit:vi.fn(async()=>{throw Error('ACK lost')}),rollback:vi.fn(async()=>{}),release:vi.fn(),destroy:vi.fn(()=>{if(discardFails)throw Error('destroy failed')})};
 const second={beginTransaction:vi.fn(async()=>{}),query:vi.fn(async(sql)=>{calls.push(sql);if(sql.includes('FROM devices'))return [[{...owner,agent_token_revoked:revoked?1:0}]];return [receipt?[{tenant_id:batch.tenant_id,device_id:batch.device_id,batch_id:batch.batch_id,request_hash:batch.request_hash,accepted_count:0,recorded_at:timestamp}]:[]]}),commit:vi.fn(),rollback:vi.fn(async()=>{}),release:vi.fn(),destroy:vi.fn()};
 const pool={getConnection:vi.fn().mockResolvedValueOnce(first).mockImplementationOnce(async()=>{if(acquireFails)throw Error('offline');return second}),end:vi.fn(async()=>{})};return {pool,first,second,calls};
}
for(const prior of [true,false])it('ambiguous commit is recovered from locked receipt, prior='+prior,async()=>{const f=recoveryPool({prior});db.setConnectionStateForTesting(true,f.pool);expect(await db.ingestTelemetryBatchOnce(batch,{tokenHash})).toEqual({duplicate:true,accepted:0,recorded_at:timestamp,batch_id:batch.batch_id});expect(f.first.destroy).toHaveBeenCalledOnce();expect(f.first.release).not.toHaveBeenCalled();expect(f.second.rollback).toHaveBeenCalledOnce();expect(f.second.release).toHaveBeenCalledOnce();expect(f.calls.filter(x=>x.startsWith('INSERT INTO telemetry_batches'))).toHaveLength(1)});
for(const options of [{receipt:false},{revoked:true},{acquireFails:true},{discardFails:true}])it('unconfirmed commit returns failure '+JSON.stringify(options),async()=>{const f=recoveryPool(options);db.setConnectionStateForTesting(true,f.pool);await expect(db.ingestTelemetryBatchOnce(batch,{tokenHash})).rejects.toThrow('TELEMETRY_COMMIT_UNCONFIRMED');expect(f.first.release).not.toHaveBeenCalled();expect(f.first.destroy).toHaveBeenCalledOnce()});
