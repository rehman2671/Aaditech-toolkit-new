import {test} from 'vitest';
import {guardTransactionConnection} from '../../transaction-connection-custody.js';
function buildCases(){
 const cases=[],add=(n,f)=>cases.push([n,f]);
 const equal=(a,b)=>{if(a!==b)throw Error('assertion mismatch: '+String(a)+' vs '+String(b))};
 const eventsEqual=(a,b)=>equal(JSON.stringify(a),JSON.stringify(b));
 const rejects=async(fn,code)=>{let e;try{await fn()}catch(err){e=err}if(!e||!String(e.message).includes(code))throw Error('expected rejection '+code)};
 const fixture=(fail=null,style='async')=>{
  const events=[],c={};
  for(const name of ['beginTransaction','query','commit','rollback','release','destroy']){
   c[name]=function(...args){
    equal(this,c);events.push(name);
    if(name===fail){if(style==='sync'||['release','destroy'].includes(name))throw Error('fixture failure');return Promise.reject(Error('fixture failure'))}
    if(['release','destroy'].includes(name))return name;
    return Promise.resolve(name==='query'?args:name);
   };
  }
  return {c,events};
 };
 for(const method of ['beginTransaction','query','commit','rollback','release']){
  for(const value of [undefined,null,42,'not callable']){
   add('reject invalid '+method+' '+String(value),async()=>{const {c,events}=fixture();c[method]=value;await rejects(()=>guardTransactionConnection(c),'INVALID_TRANSACTION_CONNECTION');eventsEqual(events,['destroy'])});
  }
 }
 for(const method of ['beginTransaction','commit','rollback'])for(const style of ['async','sync'])for(const cleanup of ['release','rollback then release']){
  add('uncertain '+method+' '+style+' '+cleanup,async()=>{
   const {c,events}=fixture(method,style),g=guardTransactionConnection(c);
   if(method!=='beginTransaction')await g.beginTransaction();
   await rejects(()=>g[method](),'fixture failure');equal(g.state,'uncertain');
   if(cleanup==='rollback then release'){try{await g.rollback()}catch{}equal(g.state,'uncertain')}
   g.release();g.release();g.destroy();equal(g.state,'closed');equal(events.filter(x=>x==='destroy').length,1);equal(events.includes('release'),false);
  });
 }
 for(const terminal of ['commit','rollback'])for(const style of ['async','sync'])add('query failure with confirmed '+terminal+' '+style,async()=>{
  const {c,events}=fixture('query',style),g=guardTransactionConnection(c);await g.beginTransaction();await rejects(()=>g.query('fixture'),'fixture failure');await g[terminal]();g.release();eventsEqual(events,['beginTransaction','query',terminal,'release']);
 });
 for(const terminal of ['commit','rollback'])add('confirmed '+terminal+' releases exactly once',async()=>{
  const {c,events}=fixture(),g=guardTransactionConnection(c);await g.beginTransaction();eventsEqual(await g.query('SELECT ?', [1]),['SELECT ?',[1]]);await g[terminal]();g.release();g.release();g.destroy();eventsEqual(events,['beginTransaction','query',terminal,'release']);
 });
 for(const method of ['query','commit','rollback'])add('reject '+method+' before begin',async()=>{const {c,events}=fixture(),g=guardTransactionConnection(c);await rejects(()=>g[method](),'INVALID_TRANSACTION_STATE');g.release();eventsEqual(events,['release'])});
 for(const method of ['beginTransaction','query','commit','rollback'])add('reject '+method+' after closure',async()=>{const {c,events}=fixture(),g=guardTransactionConnection(c);g.destroy();await rejects(()=>g[method](),'INVALID_TRANSACTION_STATE');eventsEqual(events,['destroy'])});
 for(const method of ['beginTransaction','commit','rollback'])add('release during '+method+' discards connection',async()=>{
  const {c,events}=fixture();let resolve;const held=new Promise(r=>{resolve=r});c[method]=()=>{events.push(method);return held};
  const g=guardTransactionConnection(c);if(method!=='beginTransaction')await g.beginTransaction();const p=g[method]();g.release();resolve();await p;equal(g.state,'closed');equal(events.includes('release'),false);equal(events.at(-1),'destroy');
 });
 add('active transaction release discards',async()=>{const {c,events}=fixture(),g=guardTransactionConnection(c);await g.beginTransaction();g.release();eventsEqual(events,['beginTransaction','destroy'])});
 add('missing destroy never returns uncertain connection to pool',async()=>{const {c,events}=fixture('commit');delete c.destroy;const g=guardTransactionConnection(c);await g.beginTransaction();await rejects(()=>g.commit(),'fixture failure');await rejects(()=>g.release(),'TRANSACTION_DISCARD_UNAVAILABLE');eventsEqual(events,['beginTransaction','commit']);equal(g.state,'closed')});
 add('pending query prevents commit and release discards',async()=>{const {c,events}=fixture();let resolve;c.query=()=>new Promise(r=>{resolve=r});const g=guardTransactionConnection(c);await g.beginTransaction();const q=g.query('fixture');await rejects(()=>g.commit(),'INVALID_TRANSACTION_STATE');await rejects(()=>g.rollback(),'INVALID_TRANSACTION_STATE');g.release();resolve();await q;eventsEqual(events,['beginTransaction','destroy'])});
 add('idle release exactly once',async()=>{const {c,events}=fixture(),g=guardTransactionConnection(c);g.release();g.release();eventsEqual(events,['release'])});
 return cases;
}
for(const [name,run] of buildCases())test(name,run);
