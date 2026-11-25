// Local cache availability only; MySQL remains authoritative.
export function createCacheLifecycle(){
 let current=null,ready=false,stopped=false,epoch=0;
 const valid=client=>!stopped&&current===client&&client!==null;
 return Object.freeze({
  get current(){return current},get ready(){return !stopped&&ready&&current!==null},
  install(client){
   if(stopped||current!==null||!client||typeof client.disconnect!=='function')throw Error('CACHE_CLIENT_ADMISSION_DENIED');
   current=client;ready=false;epoch++;
  },
  markReady(client){if(valid(client)&&!ready){ready=true;epoch++}},
  markUnavailable(client){if(valid(client)){ready=false;epoch++}},
  async run(fallback,work){
   const client=current,generation=epoch;
   const stillCurrent=()=>valid(client)&&ready&&generation===epoch;
   if(!stillCurrent())return fallback;
   try{const value=await work(client,stillCurrent);return stillCurrent()?value:fallback}catch{return fallback}
  },
  stop(){
   if(stopped)return;
   stopped=true;ready=false;epoch++;
   const client=current;current=null;
   if(client)client.disconnect();
  }
 });
}
