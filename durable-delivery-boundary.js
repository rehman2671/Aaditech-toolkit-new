// Strict persistence and dispatch admission; external side effects remain at-least-once.
export function outboxLeaseParameters(row){
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('INVALID_OUTBOX_LEASE_ROW');
 const {id,tenant_id,lease_token,attempts,channel}=row;
 const validId=typeof id==='number'?Number.isSafeInteger(id)&&id>0:typeof id==='string'&&/^[1-9][0-9]{0,19}$/.test(id)&&BigInt(id)<=18446744073709551615n;
 if(!validId||typeof tenant_id!=='string'||tenant_id.length>36||!tenant_id.trim()||tenant_id.trim()!==tenant_id||typeof lease_token!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(lease_token)||!Number.isSafeInteger(attempts)||attempts<1||attempts>5||!['webhook','email'].includes(channel))throw Error('INVALID_OUTBOX_LEASE_ROW');
 return [id,tenant_id,lease_token,attempts,channel];
}
export function confirmedLeaseRenewal(result){
 if(result?.affectedRows===1)return true;
 if(result?.affectedRows===0)return false;
 throw Error('OUTBOX_LEASE_RENEWAL_UNCONFIRMED');
}
export async function admitOutboxDispatch(row,{canStart,renewLease}){
 if(typeof canStart!=='function'||typeof renewLease!=='function')throw Error('INVALID_OUTBOX_DISPATCH_POLICY');
 if(canStart()!==true)return 'DEFERRED';
 let renewed;
 try{renewed=await renewLease(row)}catch{return 'LEASE_UNCONFIRMED'}
 if(renewed===false)return 'LOST_LEASE';
 if(renewed!==true)return 'LEASE_UNCONFIRMED';
 return canStart()===true?'READY':'DEFERRED';
}
export function requireLegacyTelemetryTestProfile(mode){
 if(mode!=='test')throw Error('TELEMETRY_KEYED_BATCH_REQUIRED');
}
export function requireConfirmedTelemetryInsert(result,expected){
 if(!Number.isSafeInteger(expected)||expected<1||result?.affectedRows!==expected)throw Error('TELEMETRY_INSERT_UNCONFIRMED');
}
