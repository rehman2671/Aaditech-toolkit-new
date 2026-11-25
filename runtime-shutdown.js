// Process-local lifecycle, not shared enterprise data.
export function createRuntimeShutdown({stopAccepting,stopBackground,drain,closeResources,timeoutMs=25000}){
 if(![stopAccepting,stopBackground,drain,closeResources].every(x=>typeof x==='function')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>25000)throw Error('INVALID_SHUTDOWN_POLICY');
 let pending,stopping=false;
 return Object.freeze({get stopping(){return stopping},shutdown(){
  if(pending)return pending;
  stopping=true;
  pending=(async()=>{
   let timer;
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RUNTIME_DRAIN_TIMEOUT')),timeoutMs)});
   try{
    await Promise.race([(async()=>{
     const results=await Promise.allSettled([Promise.resolve().then(stopAccepting),Promise.resolve().then(stopBackground)]);
     if(results.some(x=>x.status==='rejected'))throw Error('RUNTIME_DRAIN_FAILED');
     await drain();await closeResources();
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
