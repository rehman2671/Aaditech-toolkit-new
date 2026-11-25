(()=>{
 'use strict';
 const el=id=>document.getElementById(id),token=localStorage.getItem('auth_token');
 const status=t=>{el('observation-status').textContent=t};let cursor=null,items=[],busy=false,admin=false,pending=null,submitting=false;
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
   if(admin&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x.device_id)&&x.signals.length){
    const form=document.createElement('form'),select=document.createElement('select'),confirm=document.createElement('input'),label=node('label','');
    select.setAttribute('aria-label','Observation to report for '+x.device_id);select.replaceChildren(...x.signals.map(s=>new Option(labels[s]||s,s)));
    confirm.type='checkbox';confirm.required=true;label.className='check';label.append(confirm,document.createTextNode('Create a report only; hazard assessment remains unknown.'));
    const button=node('button','Create incident');button.type='submit';button.disabled=!!pending||submitting;
    form.append(select,label,button);form.addEventListener('submit',e=>{e.preventDefault();if(pending||submitting||!confirm.checked)return;if(typeof crypto.randomUUID!=='function'){incidentStatus('Secure HTTPS required.');return}pending=Object.freeze({deviceId:x.device_id,requestId:crypto.randomUUID(),signal:select.value,confirmation:'CONFIRM_OBSERVATION_REPORT_ONLY'});submitIncident()});card.append(form);
   }
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
 const incidentStatus=t=>{el('observation-incident-status').textContent=t};
 function incidentControls(){el('observation-incident-retry').hidden=!pending;el('observation-incident-retry').disabled=submitting;for(const b of el('observation-list').querySelectorAll('button'))b.disabled=!!pending||submitting}
 async function submitIncident(){if(!pending||submitting)return;submitting=true;incidentControls();try{
  if(token!==localStorage.getItem('auth_token'))throw Error();
  const r=await fetch('/api/v1/monitoring/observation-incident',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(pending)});
  if(token!==localStorage.getItem('auth_token'))throw Error();
  if(r.status===409){pending=null;incidentStatus('Observation expired or request conflicts. Refresh before another report.');return}
  if(!r.ok)throw Error();
  const d=await r.json();if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(d.incident_id)||d.observation_signal!==pending.signal||d.diagnostic_authorized!==false||d.repair_authorized!==false)throw Error();
  pending=null;incidentStatus('Incident '+d.incident_id+' recorded. Open the Troubleshooting review queue; no diagnostic authorized.');
 }catch{incidentStatus('Incident not confirmed. Retry same request '+pending.requestId+' or contact IT.')}finally{submitting=false;incidentControls()}}
 el('observation-incident-retry').addEventListener('click',submitIncident);
 window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue=''}});
 el('observation-filter').addEventListener('change',render);el('observation-refresh').addEventListener('click',()=>load());el('observation-next').addEventListener('click',()=>load(true));
 (async()=>{try{if(token){const r=await fetch('/api/v1/auth/me',{cache:'no-store',headers:{Authorization:'Bearer '+token}});if(r.ok&&token===localStorage.getItem('auth_token'))admin=(await r.json()).role==='SUPER_ADMIN'}}catch{}await load()})();

})();
