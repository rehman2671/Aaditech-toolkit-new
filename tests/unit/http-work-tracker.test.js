import {test} from 'vitest';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createHttpWorkTracker,installHttpRouteTracking} from '../../http-work-tracker.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const fixture=()=>{
 const req={aborted:false},calls=[],res={destroyed:false,writableEnded:false,headersSent:false,set(...a){calls.push(['set',...a]);return this},status(n){calls.push(['status',n]);return this},json(v){calls.push(['json',v]);this.writableEnded=true;return this},destroy(){this.destroyed=true;calls.push(['destroy'])}};
 return {req,res,calls,next:(...a)=>calls.push(['next',...a])};
};
const methods=['get','post','put','patch','delete','head','options','all'];
const mockApp=()=>Object.fromEntries(methods.map(m=>[m,function(...args){return {receiver:this,args,method:m}}]));
for(const method of methods)for(const nested of [false,true])test(`registration ${method} nested=${nested}`,async()=>{
 const t=createHttpWorkTracker(),app=mockApp();installHttpRouteTracking(app,t);const f=fixture();let called=0;
 const handler=async()=>{called++};const result=app[method]('/fixture',nested?[[handler]]:handler);
 assert.equal(result.receiver,app);assert.equal(result.method,method);assert.equal(result.args[0],'/fixture');
 await (nested?result.args[1][0][0]:result.args[1])(f.req,f.res,f.next);await t.sealAndDrain();assert.equal(called,1);assert.equal(t.pendingCount,0);
});
for(const argc of [0,1,2,3,4,5])test(`preserve handler arity ${argc}`,()=>{
 const t=createHttpWorkTracker(),fn=function(){};Object.defineProperty(fn,'length',{value:argc});assert.equal(t.wrap(fn).length,argc);
});
for(const v of [undefined,null,false,0,'x',{},[]])test(`reject invalid handler ${String(v)}`,()=>assert.throws(()=>createHttpWorkTracker().wrap(v),/INVALID_HTTP_HANDLER/));
for(const mode of ['aborted','destroyed','ended','headers','open'])test(`sealed admission ${mode}`,async()=>{
 const t=createHttpWorkTracker(),f=fixture();await t.sealAndDrain();let ran=false;
 if(mode==='aborted')f.req.aborted=true;if(mode==='destroyed')f.res.destroyed=true;if(mode==='ended')f.res.writableEnded=true;if(mode==='headers')f.res.headersSent=true;
 t.wrap(()=>{ran=true})(f.req,f.res,f.next);assert.equal(ran,false);
 if(mode==='open')assert.deepEqual(f.calls,[['set','Connection','close'],['status',503],['json',{error:'SERVER_DRAINING'}]]);else if(mode==='headers')assert.deepEqual(f.calls,[['destroy']]);else assert.deepEqual(f.calls,[]);
});
for(const close of ['aborted','destroyed','none'])for(const settlement of ['resolve','reject'])test(`active async work ${close} ${settlement}`,async()=>{
 const t=createHttpWorkTracker(),f=fixture(),d=deferred();const p=t.wrap(()=>d.promise)(f.req,f.res,f.next);
 assert.ok(t.pendingCount>0);if(close==='aborted')f.req.aborted=true;if(close==='destroyed')f.res.destroyed=true;
 let done=false;const drain=t.sealAndDrain();assert.equal(t.sealAndDrain(),drain);const wait=drain.then(()=>{done=true});await Promise.resolve();assert.equal(done,false);
 if(settlement==='reject')d.reject(Error('fixture'));else d.resolve('ok');await p;await wait;assert.equal(done,true);assert.equal(t.pendingCount,0);
 if(close!=='none')assert.deepEqual(f.calls,[]);
});
for(const mode of ['aborted','destroyed','sealed','open'])test(`late middleware next ${mode}`,async()=>{
 const t=createHttpWorkTracker(),f=fixture(),d=deferred();const p=t.wrap(async(req,res,next)=>{await d.promise;next('route')})(f.req,f.res,f.next);
 if(mode==='aborted')f.req.aborted=true;if(mode==='destroyed')f.res.destroyed=true;if(mode==='sealed')t.sealAndDrain();d.resolve();await p;
 if(mode==='open')assert.deepEqual(f.calls,[['next','route']]);else assert.ok(!f.calls.some(c=>c[0]==='next'));
 await t.sealAndDrain();
});
for(const failure of [Error('fixture'),null,false,'fixture'])test(`async failure forwarded ${String(failure)}`,async()=>{
 const t=createHttpWorkTracker(),f=fixture();await t.wrap(async()=>{throw failure})(f.req,f.res,f.next);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'next');assert.ok(f.calls[0][1]);await t.sealAndDrain();
});
for(const ended of [false,true])test(`post-next rejection ended=${ended}`,async()=>{
 const t=createHttpWorkTracker(),f=fixture();f.res.writableEnded=ended;await t.wrap(async(req,res,next)=>{next();throw Error('fixture')})(f.req,f.res,f.next);
 assert.equal(f.calls.filter(c=>c[0]==='next').length,1);assert.equal(f.res.destroyed,!ended);await t.sealAndDrain();
});
test('Express settings getter unchanged',()=>{const app=mockApp();installHttpRouteTracking(app,createHttpWorkTracker());assert.deepEqual(app.get('env').args,['env'])});
test('error handler gets error and original receiver',()=>{const t=createHttpWorkTracker(),f=fixture(),err=Error('fixture'),receiver={};const wrapped=t.wrap(function(e,req,res,next){assert.equal(e,err);assert.equal(this,receiver);next(e)});wrapped.call(receiver,err,f.req,f.res,f.next);assert.deepEqual(f.calls,[['next',err]])});
test('sync exception remains Express-owned',()=>{const f=fixture();assert.throws(()=>createHttpWorkTracker().wrap(()=>{throw Error('fixture')})(f.req,f.res,f.next),/fixture/)});
test('sync result and receiver unchanged',()=>{const f=fixture(),obj={};assert.equal(createHttpWorkTracker().wrap(function(){return this}).call(obj,f.req,f.res,f.next),obj)});
test('drain waits for multiple outstanding handlers',async()=>{const t=createHttpWorkTracker(),f=fixture(),a=deferred(),b=deferred();t.wrap(()=>a.promise)(f.req,f.res,f.next);t.wrap(()=>b.promise)(f.req,f.res,f.next);let done=false;const drain=t.sealAndDrain().then(()=>{done=true});a.resolve();await new Promise(r=>setImmediate(r));assert.equal(done,false);b.resolve();await drain;assert.equal(done,true)});
test('registration rejects missing methods before mutation',()=>{const app=mockApp(),old=app.get;delete app.post;assert.throws(()=>installHttpRouteTracking(app,createHttpWorkTracker()),/INVALID_HTTP_TRACKING_POLICY/);assert.equal(app.get,old)});

test('real HTTP client disconnect does not settle active handler promise',async()=>{
 const t=createHttpWorkTracker(),started=deferred(),release=deferred(),closed=deferred();
 const handler=t.wrap(async(req,res)=>{res.once('close',()=>closed.resolve());started.resolve();await release.promise});
 const server=createServer((req,res)=>handler(req,res,()=>{}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let client;try{
  client=request({host:'127.0.0.1',port:server.address().port,path:'/fixture'});client.on('error',()=>{});client.end();await started.promise;client.destroy();await closed.promise;
  await new Promise((r,j)=>server.close(e=>e?j(e):r()));let done=false;const drain=t.sealAndDrain().then(()=>{done=true});await new Promise(r=>setImmediate(r));assert.equal(done,false);assert.equal(t.pendingCount,1);release.resolve();await drain;assert.equal(done,true);
 }finally{release.resolve();client?.destroy();if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r))}}
});
test('rejected route sentinel becomes an error instead of route bypass',async()=>{const t=createHttpWorkTracker(),f=fixture();await t.wrap(async()=>{throw 'route'})(f.req,f.res,f.next);assert.ok(f.calls[0][1] instanceof Error);await t.sealAndDrain()});
