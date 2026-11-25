(()=>{
 'use strict';
 const el=id=>document.getElementById(id),token=localStorage.getItem('auth_token');
 const status=t=>{el('observation-status').textContent=t};let cursor=null,items=[],busy=false;
 const labels={HIGH_CPU_OBSERVATION:'CPU at least 90%',HIGH_MEMORY_OBSERVATION:'Memory at least 90%',LOW_DISK_OBSERVATION:'Disk free at most 10%'};
 const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n};
 const metric=(n,s)=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(1)+s:'Unavailable';
 function render(){
  const f=el('observation-filter').value;
  const shown=items.filter(x=>!f||(f==='signals'?x.signals.length:x.telemetry_state!=='RECENT'||x.reported_agent_status!=='ACTIVE'));
  el('observation-list').replaceChildren(...shown.map(x=>{
   const card=node('article','');card.className='incident-card';
   card.append(node('h3',x.hostname),node('p','Device ID: '+x.device_id),node('p','Reported agent: '+x.reported_agent_status+' | Telemetry: '+x.telemetry_state),
    node('p','CPU: '+metric(x.metrics.cpu_percent,'%')+' | Memory: '+metric(x.metrics.memory_percent,'%')+' | Disk free: '+metric(x.metrics.disk_free_gb,' GB')),
    node('p',x.signals.length?x.signals.map(s=>labels[s]||'Unknown observation').join('; '):'No pressure signals in available measurements. This does not establish healthy status.'));
   return card;
  }));
  status(shown.length+' of '+items.length+' devices on this page. No global health estimate.');
 }
 async function load(next=false){
  if(busy)return;busy=true;el('observation-refresh').disabled=true;el('observation-next').disabled=true;el('observation-results').hidden=true;items=[];status('Loading observations…');
  try{
   if(!token||token!==localStorage.getItem('auth_token'))throw Error();
   const q=new URLSearchParams(next&&cursor?{after:cursor}:{});
   const r=await fetch('/api/v1/monitoring/device-observations?'+q,{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json',Authorization:'Bearer '+token}});
   if(!r.ok||token!==localStorage.getItem('auth_token'))throw Error();
   const d=await r.json();if(!Array.isArray(d.items)||d.items.length>50||d.health_verified!==false)throw Error();
   items=d.items;cursor=d.next_cursor;el('observation-results').hidden=false;el('observation-next').hidden=!cursor;render();
  }catch{cursor=null;status('Observations unavailable. Sign in as an authorized administrator or operator; no health conclusion can be drawn.')}
  finally{busy=false;el('observation-refresh').disabled=false;el('observation-next').disabled=false}
 }
 el('observation-filter').addEventListener('change',render);el('observation-refresh').addEventListener('click',()=>load());el('observation-next').addEventListener('click',()=>load(true));load();
})();
