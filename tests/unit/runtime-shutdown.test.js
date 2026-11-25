import {it,expect} from 'vitest';
import {createRuntimeShutdown,createTaskTracker} from '../../runtime-shutdown.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
it('stops HTTP and workers concurrently and drains before closing resources, once only',async()=>{
 const a=deferred(),b=deferred(),events=[];
 const s=createRuntimeShutdown({stopAccepting:()=>{events.push('http');return a.promise},stopBackground:()=>{events.push('workers');return b.promise},drain:()=>{events.push('drain')},closeResources:()=>{events.push('close')}});
 expect(s.stopping).toBe(false);const p=s.shutdown();expect(s.stopping).toBe(true);expect(s.shutdown()).toBe(p);
 await Promise.resolve();expect(events).toEqual(['http','workers']);a.resolve();b.resolve();await p;expect(events).toEqual(['http','workers','drain','close']);
});
it('does not close resources after a failed drain',async()=>{
 let closed=false;const s=createRuntimeShutdown({stopAccepting:()=>{},stopBackground:()=>{},drain:()=>{throw Error('failure')},closeResources:()=>{closed=true}});
 await expect(s.shutdown()).rejects.toThrow();expect(closed).toBe(false);
});
it('reports bounded timeout instead of clean shutdown',async()=>{
 const a=deferred();const s=createRuntimeShutdown({stopAccepting:()=>a.promise,stopBackground:()=>{},drain:()=>{},closeResources:()=>{},timeoutMs:10});
 await expect(s.shutdown()).rejects.toThrow('RUNTIME_DRAIN_TIMEOUT');
});
it('tracks active and newly added tasks until drained, including rejected tasks',async()=>{
 const t=createTaskTracker(),a=deferred(),b=deferred();let done=false;t.track(a.promise);
 const p=t.drain().then(()=>{done=true});t.track(b.promise);a.resolve();await Promise.resolve();expect(done).toBe(false);b.reject(Error('fixture'));await p;expect(done).toBe(true);
});
