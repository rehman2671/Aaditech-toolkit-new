import {it as test} from 'vitest';
import assert from 'node:assert/strict';
import {createRuntimeShutdown} from '../../runtime-shutdown.js';
const stages=['stopAccepting','stopBackground','drain','closeResources'];
const defaults=()=>Object.fromEntries(stages.map(x=>[x,()=>{}]));
for (const stage of stages) for(const [i,bad] of [undefined,null,false,0,{},[], 'x',Promise.resolve()].entries()) test(`invalid ${stage} policy ${i}`,()=>assert.throws(()=>createRuntimeShutdown({...defaults(),[stage]:bad}),/INVALID_SHUTDOWN_POLICY/));
for(const [i,timeoutMs] of [0,-1,1.1,25001,NaN,Infinity,-Infinity,null,'10',true,{},[]].entries()) test(`invalid timeout policy ${i}`,()=>assert.throws(()=>createRuntimeShutdown({...defaults(),timeoutMs}),/INVALID_SHUTDOWN_POLICY/));
for(const stage of stages) for(const rejectLate of [false,true]) test(`timeout ${stage} late ${rejectLate?'reject':'resolve'}`,async()=>{
 const events=[];let resolve,reject;const held=new Promise((a,b)=>{resolve=a;reject=b});
 const hooks=Object.fromEntries(stages.map(x=>[x,()=>{events.push(x);if(x===stage)return held}]));
 const s=createRuntimeShutdown({...hooks,timeoutMs:100});const p=s.shutdown();await assert.rejects(p,/RUNTIME_DRAIN_TIMEOUT/);assert.equal(s.shutdown(),p);
 assert.ok(events.includes(stage));const before=[...events];if(rejectLate)reject(Error('late'));else resolve();await new Promise(r=>setImmediate(r));assert.deepEqual(events,before);
});
for(const stage of stages) for(const asyncFail of [true,false]) test(`failure ${stage} ${asyncFail}`,async()=>{
 const events=[];const hooks=Object.fromEntries(stages.map(x=>[x,()=>{events.push(x);if(x===stage){if(asyncFail)return Promise.reject(Error('fixture'));throw Error('fixture')}}]));
 const s=createRuntimeShutdown(hooks);await assert.rejects(s.shutdown());if(stage!=='closeResources')assert.ok(!events.includes('closeResources'));if(stages.indexOf(stage)<2)assert.ok(!events.includes('drain'));
});
