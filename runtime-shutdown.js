// Process-local lifecycle, not shared enterprise data.
import {performance} from 'node:perf_hooks';
export function createRuntimeShutdown({stopAccepting,stopBackground,drain,closeResources,timeoutMs=25000}){
 if(![stopAccepting,stopBackground,drain,closeResources].every(x=>typeof x==='function')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>25000)throw Error('INVALID_SHUTDOWN_POLICY');
 let pending,stopping=false;
 return Object.freeze({get stopping(){return stopping},shutdown(){
  if(pending)return pending;
  stopping=true;
  const expires=performance.now()+timeoutMs;
  let expired=false;
  const fence=()=>{if(expired||performance.now()>=expires){expired=true;throw Error('RUNTIME_DRAIN_TIMEOUT')}};
  pending=(async()=>{
   let timer;
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('RUNTIME_DRAIN_TIMEOUT'))},timeoutMs)});
   try{
    await Promise.race([(async()=>{
     const results=await Promise.allSettled([Promise.resolve().then(()=>{fence();return stopAccepting()}),Promise.resolve().then(()=>{fence();return stopBackground()})]);
     fence();
     if(results.some(x=>x.status==='rejected'))throw Error('RUNTIME_DRAIN_FAILED');
     await drain();fence();await closeResources();fence();
    })(),deadline]);
   }finally{clearTimeout(timer)}
  })();
  return pending;
 }});
}
export function createTaskTracker(){
 const pending=new Set();
 return Object.freeze({track(promise){
  const work=Promise.resolve(promise);pending.add(work);
  void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
 },async drain(){while(pending.size)await Promise.allSettled([...pending])}});
}
