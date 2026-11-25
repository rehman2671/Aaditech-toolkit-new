import {test} from 'vitest';
import {withDeviceAdvisoryLocks,observeMysqlPool} from '../../database-pool-custody.js';
function buildCases(){
 const cases=[],add=(name,run)=>cases.push([name,run]);
 const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('assertion failed: '+JSON.stringify(a)+' != '+JSON.stringify(b))};
 const reject=async(fn,code)=>{let e;try{await fn()}catch(err){e=err}if(!e||!e.message.includes(code))throw Error('expected '+code+' got '+e?.message)};
 const keys=['itk:'+'a'.repeat(56),'itk:'+'b'.repeat(56)];
 const fixture=(acquires=[1,1],releases=[1,1])=>{
  const events=[];let ai=0,ri=0;
  const conn={async query(sql,[key]){
   const get=sql.includes('GET_LOCK');events.push([get?'get':'release-lock',key]);const v=get?acquires[ai++]:releases[ri++];
   if(v instanceof Error)throw v;
   return [Array.isArray(v)?v:[{[get?'acquired':'released']:v}]];
  },release(){events.push(['release'])},destroy(){events.push(['destroy'])}};
  return {conn,events};
 };
 for(const val of [null,undefined,false,true,2,-1,'01','x',[],[{},{}],Error('query failure')]){
  for(const pos of [0,1])add('uncertain acquisition '+String(val)+' position '+pos,async()=>{
   const a=[1,1];a[pos]=val;const {conn,events}=fixture(a);let called=false;
   await reject(()=>withDeviceAdvisoryLocks(conn,keys,()=>{called=true},()=>true),val instanceof Error?'query failure':'DEVICE_LOCK_ACQUISITION_UNCONFIRMED');
   eq(called,false);eq(events.at(-1),['destroy']);eq(events.filter(e=>e[0]==='release-lock').length,pos);
  });
 }
 for(const val of [null,undefined,false,true,0,-1,2,'0','01',[],[{},{}],Error('release failure')]){
  for(const pos of [0,1])add('uncertain release '+String(val)+' position '+pos,async()=>{
   const r=[1,1];r[pos]=val;const {conn,events}=fixture([1,1],r);
   await reject(()=>withDeviceAdvisoryLocks(conn,keys,()=>42,()=>true),'DEVICE_LOCK_RELEASE_UNCONFIRMED');
   eq(events.at(-1),['destroy']);eq(events.filter(e=>e[0]==='release-lock').map(e=>e[1]),[keys[1],keys[0]]);
  });
 }
 for(const val of [0,'0'])for(const pos of [0,1])add('definite lock timeout '+val+' position '+pos,async()=>{
  const a=[1,1];a[pos]=val;const {conn,events}=fixture(a);await reject(()=>withDeviceAdvisoryLocks(conn,keys,()=>{throw Error('unexpected work')},()=>true),'timed out');eq(events.at(-1),['release']);eq(events.filter(e=>e[0]==='release-lock').length,pos);
 });
 for(const val of [1,'1'])add('confirmed acquisition and reverse release '+val,async()=>{
  const {conn,events}=fixture([val,val],[val,val]);eq(await withDeviceAdvisoryLocks(conn,keys,()=>42,()=>true),42);eq(events,[['get',keys[0]],['get',keys[1]],['release-lock',keys[1]],['release-lock',keys[0]],['release']]);
 });
 for(const failAt of [1,2,3,4])add('pool continuity check '+failAt,async()=>{
  const {conn,events}=fixture();let count=0,called=false;await reject(()=>withDeviceAdvisoryLocks(conn,keys,()=>{called=true},()=>++count!==failAt),'DEVICE_LOCK_POOL_CHANGED');eq(called,failAt===4);eq(events.at(-1),['release']);
 });
 add('callback failure preserves error after verified cleanup',async()=>{const {conn,events}=fixture();await reject(()=>withDeviceAdvisoryLocks(conn,keys,()=>{throw Error('work failed')},()=>true),'work failed');eq(events.at(-1),['release'])});
 add('callback failure with uncertain cleanup destroys and preserves error',async()=>{const {conn,events}=fixture([1,1],[0,1]);await reject(()=>withDeviceAdvisoryLocks(conn,keys,()=>{throw Error('work failed')},()=>true),'work failed');eq(events.at(-1),['destroy'])});
 for(const invalid of [[],[keys[0],keys[0]],[keys[1],keys[0]],['wrong'],[keys[0],keys[1],'itk:'+'c'.repeat(56)]])add('invalid lock keys '+JSON.stringify(invalid),async()=>{const {conn,events}=fixture();await reject(()=>withDeviceAdvisoryLocks(conn,invalid,()=>{},()=>true),'INVALID_DEVICE_LOCK_POLICY');eq(events,[['release']])});
 for(const outcome of [true,false,null,1,'true',Error('probe')])for(const stale of [false,true])add('pool probe '+String(outcome)+' stale='+stale,async()=>{
  const candidate={};let current=candidate,ready=true,failed=0;
  const value=await observeMysqlPool(candidate,{isCurrent:p=>p===current,isReady:()=>ready,probe:async()=>{if(stale)current={};if(outcome instanceof Error)throw outcome;return outcome},onFailure:()=>{failed++;ready=false}});
  eq(value,outcome===true&&!stale);eq(failed,outcome!==true&&!stale?1:0);
 });
 for(const mode of ['missing','stale','not ready'])add('probe admission '+mode,async()=>{const candidate=mode==='missing'?null:{};let called=false;eq(await observeMysqlPool(candidate,{isCurrent:()=>mode!=='stale',isReady:()=>mode!=='not ready',probe:()=>{called=true;return true},onFailure:()=>{throw Error('unexpected failure')}}),false);eq(called,false)});
 add('successful probe cannot restore concurrently failed readiness',async()=>{const candidate={};let ready=true;eq(await observeMysqlPool(candidate,{isCurrent:()=>true,isReady:()=>ready,probe:()=>{ready=false;return true},onFailure:()=>{throw Error('unexpected failure')}}),false)});
 return cases;
}
for(const [name,run] of buildCases())test(name,run);
