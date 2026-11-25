// Read-only, current-credential proof after an ambiguous keyed telemetry COMMIT.
export function verifyRecoveredTelemetryReceipt(rows,expected){
 if(!Array.isArray(rows)||rows.length!==1||!expected||typeof expected.tokenHash!=='string'||!/^[a-f0-9]{64}$/.test(expected.tokenHash))return null;
 const r=rows[0];
 if(!r||typeof r!=='object'||r.tenant_id!==expected.tenantId||String(r.device_id)!==String(expected.deviceId)||r.batch_id!==expected.batchId||r.request_hash!==expected.hash||r.device_token_hash!==expected.tokenHash||![0,false,'0'].includes(r.agent_token_revoked)||!Number.isSafeInteger(expected.accepted)||expected.accepted<0||!(r.accepted_count===expected.accepted||r.accepted_count===String(expected.accepted)))return null;
 const recorded=r.recorded_at;
 if(!(recorded instanceof Date)&&typeof recorded!=='string')return null;
 if(typeof recorded==='string'&&!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(recorded))return null;
 const timestamp=new Date(recorded);
 if(!Number.isFinite(timestamp.getTime())||timestamp.getUTCFullYear()<2000||timestamp.getUTCFullYear()>9999)return null;
 return {duplicate:true,accepted:expected.accepted,recorded_at:timestamp,batch_id:expected.batchId};
}
export async function recoverCommittedTelemetryReceipt({expected,acquire,isCurrent}){
 if(typeof acquire!=='function'||typeof isCurrent!=='function'||!isCurrent()||typeof expected?.tokenHash!=='string'||!/^[a-f0-9]{64}$/.test(expected.tokenHash))return null;
 let conn,receipt=null,confirmed=false;
 try{
  conn=await acquire();
  if(!isCurrent())return null;
  await conn.beginTransaction();
  // Lock the same device first, then receipt, as the writer does.
  const [owners]=await conn.query('SELECT id, tenant_id, device_token_hash, agent_token_revoked FROM devices WHERE id = ? AND tenant_id = ? FOR UPDATE',[expected.deviceId,expected.tenantId]);
  const owner=Array.isArray(owners)&&owners.length===1?owners[0]:null;
  if(!owner||String(owner.id)!==String(expected.deviceId)||owner.tenant_id!==expected.tenantId||owner.device_token_hash!==expected.tokenHash||![0,false,'0'].includes(owner.agent_token_revoked))return null;
  const [rows]=await conn.query('SELECT tenant_id,device_id,batch_id,request_hash,accepted_count,recorded_at FROM telemetry_batches WHERE tenant_id=? AND device_id=? AND batch_id=? FOR UPDATE',[expected.tenantId,expected.deviceId,expected.batchId]);
  receipt=verifyRecoveredTelemetryReceipt(Array.isArray(rows)?rows.map(r=>({...r,device_token_hash:owner.device_token_hash,agent_token_revoked:owner.agent_token_revoked})):rows,expected);
  await conn.rollback();confirmed=true;
 }catch{return null}
 finally{
  if(conn){
   if(confirmed){try{conn.release()}catch{confirmed=false}}
   else{try{conn.destroy()}catch{}}
  }
 }
 return confirmed&&isCurrent()?receipt:null;
}
