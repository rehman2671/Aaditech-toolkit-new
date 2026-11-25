// Observed telemetry only. No device command, remediation, score or health
// assertion from registration, heartbeat, missing measurements or stale data.
const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const deviceId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x);
const num=x=>typeof x==='number'?x:typeof x==='string'&&/^(0|[1-9][0-9]*)(?:\.[0-9]+)?%?$/.test(x)?Number(x.replace('%','')):NaN;
const percent=x=>{const n=num(x);return Number.isFinite(n)&&n>=0&&n<=100?n:null};
const capacity=x=>{const n=num(x);return Number.isFinite(n)&&n>=0?n:null};
export const DEVICE_OBSERVATION_FRESHNESS_SECONDS=3600;
const fail=()=>{throw Error('MONITORING_UNVERIFIED')};
export function classifyDeviceObservation(r,tenant){
 if(!r||r.tenant_id!==tenant||!deviceId(r.id)||typeof r.hostname!=='string'||r.hostname.length<1||r.hostname.length>128)fail();
 const age=r.telemetry_age_seconds===null?null:num(r.telemetry_age_seconds);
 const negative=typeof r.telemetry_age_seconds==='number'&&r.telemetry_age_seconds<0||typeof r.telemetry_age_seconds==='string'&&/^-[0-9]+$/.test(r.telemetry_age_seconds);
 const state=r.telemetry_age_seconds===null?'NO_TELEMETRY':negative?'CLOCK_UNVERIFIED':!Number.isFinite(age)?'CLOCK_UNVERIFIED':age>DEVICE_OBSERVATION_FRESHNESS_SECONDS?'STALE':'RECENT';
 const active=['online','active'].includes(String(r.status).toLowerCase());
 const revoked=[true,1,'1'].includes(r.agent_token_revoked);
 const usable=state==='RECENT'&&active&&!revoked;
 const total=capacity(r.disk_total_gb),free=capacity(r.disk_free_gb);
 const metrics=usable?{cpu_percent:percent(r.cpu_usage),memory_percent:percent(r.memory_usage),disk_free_gb:total!==null&&total>0&&free!==null&&free<=total?free:null,disk_total_gb:total!==null&&total>0&&free!==null&&free<=total?total:null}:{cpu_percent:null,memory_percent:null,disk_free_gb:null,disk_total_gb:null};
 const signals=[];
 if(metrics.cpu_percent!==null&&metrics.cpu_percent>=90)signals.push('HIGH_CPU_OBSERVATION');
 if(metrics.memory_percent!==null&&metrics.memory_percent>=90)signals.push('HIGH_MEMORY_OBSERVATION');
 if(metrics.disk_total_gb!==null&&metrics.disk_free_gb/metrics.disk_total_gb<=0.1)signals.push('LOW_DISK_OBSERVATION');
 return {device_id:r.id,hostname:r.hostname,reported_agent_status:revoked?'REVOKED':active?'ACTIVE':'NOT_ACTIVE',telemetry_state:state,telemetry_age_seconds:state==='RECENT'||state==='STALE'?age:null,metrics,signals,health_verified:false,diagnostic_authorized:false,repair_authorized:false};
}
