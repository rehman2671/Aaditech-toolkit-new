// Process-local MySQL observation and advisory-session custody.
export async function withDeviceAdvisoryLocks(connection,keys,work,isCurrent){
 const held=[];let uncertain=false,success=false;
 try{
  if(!Array.isArray(keys)||!keys.length||keys.length>2||new Set(keys).size!==keys.length||!keys.every(k=>typeof k==='string'&&/^itk:[a-f0-9]{56}$/.test(k))||keys.some((k,i)=>i>0&&keys[i-1]>=k)||typeof work!=='function'||typeof isCurrent!=='function')throw Error('INVALID_DEVICE_LOCK_POLICY');
  if(!isCurrent())throw Error('DEVICE_LOCK_POOL_CHANGED');
  for(const key of keys){
   uncertain=true;
   const [rows]=await connection.query('SELECT GET_LOCK(?, 10) AS acquired',[key]);
   if(!Array.isArray(rows)||rows.length!==1||![0,1,'0','1'].includes(rows[0]?.acquired))throw Error('DEVICE_LOCK_ACQUISITION_UNCONFIRMED');
   uncertain=false;
   if(rows[0].acquired===0||rows[0].acquired==='0')throw Error('Device identity lock acquisition timed out');
   held.push(key);
   if(!isCurrent())throw Error('DEVICE_LOCK_POOL_CHANGED');
  }
  const result=await work();
  if(!isCurrent())throw Error('DEVICE_LOCK_POOL_CHANGED');
  success=true;
  return result;
 }finally{
  for(const key of held.reverse()){
   try{
    const [rows]=await connection.query('SELECT RELEASE_LOCK(?) AS released',[key]);
    if(!Array.isArray(rows)||rows.length!==1||![1,'1'].includes(rows[0]?.released))uncertain=true;
   }catch{uncertain=true}
  }
  if(uncertain){
   if(typeof connection.destroy!=='function')throw Error('DEVICE_LOCK_DISCARD_UNAVAILABLE');
   connection.destroy();
   if(success)throw Error('DEVICE_LOCK_RELEASE_UNCONFIRMED');
  }else connection.release();
 }
}
export async function observeMysqlPool(candidate,{isCurrent,isReady,probe,onFailure}){
 if(!candidate||!isCurrent(candidate)||!isReady())return false;
 try{
  if(await probe(candidate)!==true){
   if(isCurrent(candidate))onFailure();
   return false;
  }
  return isCurrent(candidate)&&isReady();
 }catch{
  if(isCurrent(candidate))onFailure();
  return false;
 }
}
