(()=>{
 'use strict';
 const el=id=>document.getElementById(id),token=localStorage.getItem('auth_token'),q=new URLSearchParams(location.search),incidentId=q.get('incidentId'),deviceId=q.get('deviceId');
 const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
 const status=t=>{el('hazard-status').textContent=t};
 if(!token||!uuid(incidentId)||!uuid(deviceId)||[...q.keys()].length!==2){status('Open an eligible incident from the authenticated review queue.');return}
 const path='/api/v1/troubleshooting/hazard-assessment';let pending=null,busy=false,current=null;
 async function api(body){
  if(token!==localStorage.getItem('auth_token'))throw Error();
  const r=await fetch(path+(body?'':'?'+new URLSearchParams({incidentId,deviceId})),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(token!==localStorage.getItem('auth_token'))throw Error();if(!r.ok){const e=Error();e.status=r.status;throw e}return r.json();
 }
 function controls(){for(const k of ['hazard-choice','hazard-confirm','hazard-save','hazard-refresh'])el(k).disabled=busy||!!pending;el('hazard-retry').hidden=!pending;el('hazard-retry').disabled=busy}
 function render(r){
  if(r.incident_id!==incidentId||r.device_id!==deviceId||r.safety_verified!==false||r.diagnostic_authorized!==false||r.repair_authorized!==false||!['NOT_RECORDED','RECORDED'].includes(r.assessment_state))throw Error();
  if(r.assessment_state==='RECORDED'&&(!uuid(r.assessment_id)||!['NONE','PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE'].includes(r.assessment)))throw Error();
  current=r;el('hazard-panel').hidden=false;el('hazard-form').hidden=r.assessment_state==='RECORDED';
  el('hazard-result').textContent=r.assessment_state==='RECORDED'?'Recorded: '+r.assessment+(r.human_referral_required?' — qualified human referral required.':' — safety not verified.'):'No screening recorded.';
 }
 async function load(){if(busy||pending)return;busy=true;controls();try{render(await api());status('Screening status loaded.')}catch{current=null;el('hazard-panel').hidden=true;status('Screening unavailable or incident not eligible.')}finally{busy=false;controls()}}
 async function save(){if(busy||!pending)return;busy=true;controls();try{const r=await api(pending);if(r.assessment_state!=='RECORDED'||r.assessment!==pending.assessment)throw Error();render(r);pending=null;status('Human screening recorded. No execution authorized.')}catch(e){if(e.status===409){pending=null;current=null;el('hazard-form').hidden=true;status('Screening conflict. Refresh before continuing.')}else status('Screening not confirmed. Retry same request '+pending.requestId+' or contact IT.')}finally{busy=false;controls()}}
 el('hazard-form').addEventListener('submit',e=>{e.preventDefault();if(busy||pending||current?.assessment_state!=='NOT_RECORDED'||!el('hazard-confirm').checked)return;if(typeof crypto.randomUUID!=='function'){status('Secure HTTPS required.');return}pending=Object.freeze({incidentId,deviceId,requestId:crypto.randomUUID(),assessment:el('hazard-choice').value,confirmation:'CONFIRM_HUMAN_HAZARD_SCREENING_ONLY'});save()});
 el('hazard-refresh').addEventListener('click',load);el('hazard-retry').addEventListener('click',save);window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue=''}});load();
})();
