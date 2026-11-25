// Process-local custody of an already acquired MySQL transaction connection.
// Uncertain BEGIN/COMMIT/ROLLBACK never permits pool reuse, even after a later rollback.
export function guardTransactionConnection(connection){
 const required=['beginTransaction','query','commit','rollback','release'];
 if(!connection||!required.every(name=>typeof connection[name]==='function')){
  if(typeof connection?.destroy==='function')connection.destroy();
  throw Error('INVALID_TRANSACTION_CONNECTION');
 }
 let state='idle',closed=false,queries=0;
 const requireState=(allowed)=>{
  if(closed||!allowed.includes(state)||queries)throw Error('INVALID_TRANSACTION_STATE');
 };
 function destroy(){
  if(closed)return;
  closed=true;
  if(typeof connection.destroy!=='function')throw Error('TRANSACTION_DISCARD_UNAVAILABLE');
  return connection.destroy();
 }
 return Object.freeze({
  get state(){return closed?'closed':state},
  async beginTransaction(){
   requireState(['idle']);state='beginning';
   try{const result=await connection.beginTransaction();state='active';return result}
   catch(err){state='uncertain';throw err}
  },
  async query(...args){
   if(closed||state!=='active')throw Error('INVALID_TRANSACTION_STATE');
   queries++;
   try{return await connection.query(...args)}
   finally{queries--}
  },
  async commit(){
   requireState(['active']);state='committing';
   try{const result=await connection.commit();state='committed';return result}
   catch(err){state='uncertain';throw err}
  },
  async rollback(){
   requireState(['active','uncertain']);
   const uncertain=state==='uncertain';state='rollingBack';
   try{const result=await connection.rollback();state=uncertain?'uncertain':'rolledBack';return result}
   catch(err){state='uncertain';throw err}
  },
  release(){
   if(closed)return;
   if(queries||!['idle','committed','rolledBack'].includes(state))return destroy();
   closed=true;return connection.release();
  },
  destroy
 });
}
