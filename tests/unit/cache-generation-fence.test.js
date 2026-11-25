import {test} from 'vitest';
import {createCacheLifecycle} from '../../cache-runtime-lifecycle.js';
function cases(){
 const out=[],add=(n,f)=>out.push([n,f]);
 const equal=(a,b)=>{if(a!==b)throw Error('assertion mismatch')};
 for(const fallback of [false,null])for(const value of [true,0,'old',null])for(const cycles of [1,2,3])add('old result after '+cycles+' reconnect(s) '+String(fallback)+' '+String(value),async()=>{
  const l=createCacheLifecycle(),c={disconnect(){}};l.install(c);l.markReady(c);
  let finish,valid;const p=l.run(fallback,(_,v)=>{valid=v;return new Promise(r=>{finish=r})});
  for(let i=0;i<cycles;i++){l.markUnavailable(c);l.markReady(c)}
  equal(l.ready,true);equal(valid(),false);finish(value);equal(await p,fallback);equal(await l.run(fallback,()=>42),42);
 });
 for(const repetitions of [1,2,3])add('duplicate ready does not invalidate '+repetitions,async()=>{const l=createCacheLifecycle(),c={disconnect(){}};l.install(c);l.markReady(c);let finish;const p=l.run(null,()=>new Promise(r=>{finish=r}));for(let i=0;i<repetitions;i++)l.markReady(c);finish(42);equal(await p,42)});
 return out;
}
for(const [name,run] of cases())test(name,run);
