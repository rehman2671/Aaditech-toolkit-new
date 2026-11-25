import {test} from 'vitest';
import {outboxLeaseParameters,confirmedLeaseRenewal,admitOutboxDispatch,requireLegacyTelemetryTestProfile,requireConfirmedTelemetryInsert} from '../../durable-delivery-boundary.js';
function buildCases(){
 const cases=[],add=(name,run)=>cases.push([name,run]);
 const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('assertion failed')};
 const reject=async(fn,code)=>{let e;try{await fn()}catch(err){e=err}if(!e||!String(e.message).includes(code))throw Error('expected '+code)};
 const row={id:7,tenant_id:'tenant-A',lease_token:'12345678-1234-4123-8123-123456789abc',attempts:1,channel:'email'};
 for(const [field,values] of Object.entries({
  id:[0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'0','01','-1','1e2','18446744073709551616','',null],
  tenant_id:['',' ',' tenant','tenant ','x'.repeat(37),null,7],
  lease_token:['lease-A','12345678-1234-1123-8123-123456789abc','12345678-1234-4123-7123-123456789abc','12345678-1234-4123-8123-123456789ABC',null,7],
  attempts:[0,6,-1,1.5,'1',null],
  channel:['sms','EMAIL',null]
 }))for(const [i,value] of values.entries())add('reject lease '+field+' '+i,()=>reject(()=>outboxLeaseParameters({...row,[field]:value}),'INVALID_OUTBOX_LEASE_ROW'));
 for(const id of [1,Number.MAX_SAFE_INTEGER,'1','18446744073709551615'])add('canonical bigint lease id '+id,()=>eq(outboxLeaseParameters({...row,id}),[id,row.tenant_id,row.lease_token,1,'email']));
 for(const attempts of [1,2,3,4,5])add('lease attempt '+attempts,()=>eq(outboxLeaseParameters({...row,attempts})[3],attempts));
 for(const [i,result] of [undefined,null,{}, {affectedRows:2},{affectedRows:-1},{affectedRows:'1'},{affectedRows:true}].entries())add('unconfirmed renewal result '+i,()=>reject(()=>confirmedLeaseRenewal(result),'OUTBOX_LEASE_RENEWAL_UNCONFIRMED'));
 for(const n of [0,1])add('confirmed renewal '+n,()=>eq(confirmedLeaseRenewal({affectedRows:n}),n===1));
 for(const mode of [undefined,null,'production','development','staging','TEST',''])add('legacy telemetry refusal '+String(mode),()=>reject(()=>requireLegacyTelemetryTestProfile(mode),'TELEMETRY_KEYED_BATCH_REQUIRED'));
 add('test legacy telemetry permitted',()=>requireLegacyTelemetryTestProfile('test'));
 for(const [i,result] of [undefined,null,{}, {affectedRows:0},{affectedRows:1},{affectedRows:3},{affectedRows:'2'}].entries())add('unconfirmed telemetry insert '+i,()=>reject(()=>requireConfirmedTelemetryInsert(result,2),'TELEMETRY_INSERT_UNCONFIRMED'));
 add('confirmed exact telemetry insert',()=>requireConfirmedTelemetryInsert({affectedRows:2},2));
 for(const [i,value] of [false,null,undefined,0,'true',true].entries())add('dispatch gate result '+i,async()=>{let calls=0;eq(await admitOutboxDispatch(row,{canStart:()=>true,renewLease:async r=>{eq(r,row);calls++;return value}}),value===true?'READY':value===false?'LOST_LEASE':'LEASE_UNCONFIRMED');eq(calls,1)});
 add('renewal rejection is unconfirmed, not a retryable delivery failure',async()=>eq(await admitOutboxDispatch(row,{canStart:()=>true,renewLease:()=>{throw Error('offline')}}),'LEASE_UNCONFIRMED'));
 add('stopped before renewal does not renew',async()=>{let calls=0;eq(await admitOutboxDispatch(row,{canStart:()=>false,renewLease:()=>{calls++;return true}}),'DEFERRED');eq(calls,0)});
 add('stop during lease renewal prevents dispatch',async()=>{let active=true;eq(await admitOutboxDispatch(row,{canStart:()=>active,renewLease:async()=>{active=false;return true}}),'DEFERRED')});
 return cases;
}
for(const [name,run] of buildCases())test(name,run);
