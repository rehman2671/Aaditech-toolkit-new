// Linux sysfs, single battery only. Fixed kernel interface; no commands,
// identifiers, raw inventory, writes, network or inferred wear.
import {constants} from 'node:fs';
import {open,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='/sys/class/power_supply';
async function readValue(path){
 const f=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);
 try{
  const b=Buffer.alloc(65);let n=0;
  while(n<b.length){const {bytesRead}=await f.read(b,n,b.length-n,null);if(!bytesRead)break;n+=bytesRead}
  if(n>64)return null;
  const s=b.subarray(0,n).toString('latin1');
  return /^[\x20-\x7e]+\n?$/.test(s)?s.trim():null;
 }finally{await f.close()}
}
export function normalizeLinuxBattery({capacity,status}={}){
 const charge=typeof capacity==='string'&&/^(0|[1-9][0-9]{0,2})$/.test(capacity)&&String(Number(capacity))===capacity&&Number(capacity)<=100?Number(capacity):null;
 const states=new Map([['Charging','CHARGING'],['Discharging','DISCHARGING'],['Full','FULL'],['Not charging','NOT_CHARGING']]);
 return Object.freeze({schema:'aaditech-battery-diagnostic-v1',charge_percent:charge,
  charging_state:states.get(status)??null,capacity_percent:null});
}
export async function collectLocalBatteryDiagnostic({confirmation}={}){
 if(confirmation!=='COLLECT_LOCAL_BATTERY_ONLY')throw Error('EXPLICIT_LOCAL_BATTERY_POLICY_REQUIRED');
 let doc=normalizeLinuxBattery();
 if(process.platform==='linux'){
  try{
   const names=await readdir(root);
   if(names.length>32||names.some(x=>x.length>64||!/^[A-Za-z0-9_-]+$/.test(x)))throw Error('UNKNOWN_POWER_SUPPLY_INVENTORY');
   const batteries=[];
   for(const name of names){
    const type=await readValue(root+'/'+name+'/type');
    if(!type)throw Error('UNKNOWN_POWER_SUPPLY_TYPE');
    if(type==='Battery')batteries.push(name);
   }
   if(batteries.length===1){
    const base=root+'/'+batteries[0];
    const [capacity,status]=await Promise.all(['capacity','status'].map(k=>readValue(base+'/'+k).catch(()=>null)));
    // Recheck inventory before returning observations.
    const after=await readdir(root);
    if(JSON.stringify([...names].sort())===JSON.stringify([...after].sort())&&await readValue(base+'/type')==='Battery')
     doc=normalizeLinuxBattery({capacity,status});
   }
  }catch{}
 }
 const artifact=Buffer.from(JSON.stringify(doc));
 return Object.freeze({artifact,artifact_sha256:createHash('sha256').update(artifact).digest('hex'),
  measured_fields:[doc.charge_percent,doc.charging_state].filter(x=>x!==null).length,
  collection_scope:'LOCAL_OPERATOR_REFERENCE',measurement_truth_verified:false,remote_execution_authorized:false,production_accepted:false});
}
