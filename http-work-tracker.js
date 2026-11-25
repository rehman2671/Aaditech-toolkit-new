// Process-local promises only; never authoritative tenant or transaction state.
export function createHttpWorkTracker(){
 const pending=new Set();let sealed=false,draining;
 const closed=(req,res)=>req.aborted===true||res.destroyed===true;
 function refuse(req,res){
  if(closed(req,res)||res.writableEnded)return;
  if(res.headersSent){res.destroy();return}
  res.set('Connection','close');res.status(503).json({error:'SERVER_DRAINING'});
 }
 function wrap(handler){
  if(typeof handler!=='function')throw Error('INVALID_HTTP_HANDLER');
  const errorHandler=handler.length===4;
  function tracked(...args){
   const offset=errorHandler?1:0,req=args[offset],res=args[offset+1],next=args[offset+2];
   if(closed(req,res))return;
   if(sealed){refuse(req,res);return}
   let forwarded=false;
   const forward=(...values)=>{
    if(closed(req,res))return;
    if(sealed){refuse(req,res);return}
    forwarded=true;return next(...values);
   };
   args[offset+2]=forward;
   const result=Reflect.apply(handler,this,args);
   if(!result||typeof result.then!=='function')return result;
   const work=Promise.resolve(result);
   // Express 4 does not automatically forward rejected returned promises.
   const completion=work.catch(err=>{
    if(closed(req,res))return;
    if(forwarded){if(!res.writableEnded)res.destroy();return}
    return forward(err instanceof Error?err:Error('HTTP_HANDLER_REJECTED'));
   });
   // Include the rejection forwarding itself in the drain boundary.
   pending.add(completion);
   void completion.then(()=>pending.delete(completion),()=>pending.delete(completion));
   return completion;
  }
  Object.defineProperty(tracked,'length',{value:handler.length});
  return tracked;
 }
 return Object.freeze({wrap,get pendingCount(){return pending.size},get sealed(){return sealed},sealAndDrain(){
  sealed=true;
  if(!draining)draining=(async()=>{while(pending.size)await Promise.allSettled([...pending])})();
  return draining;
 }});
}
// Preserve Express app.get(setting), receiver, nested handler arrays and route
// registration return value. Only direct application route registration is
// covered; third-party middleware/router internals are not instrumented.
export function installHttpRouteTracking(app,tracker){
 if(!app||typeof tracker?.wrap!=='function')throw Error('INVALID_HTTP_TRACKING_POLICY');
 const methods=['get','post','put','patch','delete','head','options','all'];
 if(!methods.every(name=>typeof app[name]==='function'))throw Error('INVALID_HTTP_TRACKING_POLICY');
 const transform=value=>Array.isArray(value)?value.map(transform):typeof value==='function'?tracker.wrap(value):value;
 for(const name of methods){
  const original=app[name];
  app[name]=function(path,...handlers){
   return Reflect.apply(original,this,handlers.length?[path,...handlers.map(transform)]:[path]);
  };
 }
 return app;
}
