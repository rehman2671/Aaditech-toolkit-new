(()=>{
 'use strict';
 const el=id=>document.getElementById(id),token=localStorage.getItem('auth_token'),q=new URLSearchParams(location.search),incidentId=q.get('incidentId'),deviceId=q.get('deviceId');
 const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
 const status=t=>{el('consent-status').textContent=t};
 if(!token||!uuid(incidentId)||!uuid(deviceId)||[...q.keys()].length!==2){status('Sign in and open an eligible incident from the reports page.');return}
 let role,current=null,pending=null,busy=false,planPending=null,planBusy=false;
 const path='/api/v1/troubleshooting/diagnostic-consent';
 async function api(url,body){
  if(token!==localStorage.getItem('auth_token'))throw Error('SESSION_CHANGED');
  const r=await fetch(url,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(token!==localStorage.getItem('auth_token'))throw Error('SESSION_CHANGED');
  if(!r.ok){const e=Error();e.status=r.status;throw e}const data=await r.json();
  if(token!==localStorage.getItem('auth_token'))throw Error('SESSION_CHANGED');
  return data;
 }
 function controls(){
  for(const id of ['consent-action','consent-confirm','consent-save','consent-refresh'])el(id).disabled=busy||!!pending||planBusy||!!planPending;
  el('consent-retry').hidden=!pending;el('consent-retry').disabled=busy;
 }
 function show(r){
  if(r.incident_id!==incidentId||r.device_id!==deviceId||!Number.isSafeInteger(r.revision)||r.revision<0||typeof r.expired!=='boolean'||(r.state==='NOT_REQUESTED'?(r.revision!==0||r.expired!==false):(!uuid(r.consent_id)||r.revision<1))||r.diagnostic_authorized!==false||r.production_accepted!==false||!['NOT_REQUESTED','REQUESTED','GRANTED','DENIED','REVOKED'].includes(r.state)||r.scope!=='REVIEW_ONLY'||r.execution_authorized!==false||r.repair_authorized!==false)throw Error();
  current=r;el('consent-details').replaceChildren();
  el('plan-panel').hidden=role!=='SUPER_ADMIN'||r.state!=='GRANTED'||r.expired;el('plan-form').hidden=true;
  for(const [k,v] of [['Incident',incidentId],['Device',deviceId],['Diagnostic category',r.diagnostic_id],['State',r.state],['Expired',r.expired?'Yes':'No']]){
   const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;el('consent-details').append(dt,dd)
  }
  const actions=role==='SUPER_ADMIN'&&r.state==='NOT_REQUESTED'?['REQUEST']:role==='MONITORING'&&r.state==='REQUESTED'&&!r.expired?['GRANT','DENY']:role==='MONITORING'&&r.state==='GRANTED'?['REVOKE']:[];
  el('consent-action').replaceChildren(...actions.map(a=>new Option(a,a)));el('consent-confirm').checked=false;el('consent-form').hidden=!actions.length;el('consent-panel').hidden=false;
 }
 async function load(){if(busy||pending||planBusy||planPending)return;busy=true;controls();planControls();try{show(await api(path+'?'+new URLSearchParams({incidentId,deviceId})));status('Consent status loaded.')}catch{current=null;el('consent-panel').hidden=true;el('plan-panel').hidden=true;status('Consent unavailable or incident not eligible. No action was authorized.')}finally{busy=false;controls();planControls()}}
 async function submit(){if(busy||!pending||planBusy||planPending)return;busy=true;controls();planControls();try{
  const r=await api(path,pending);if(!uuid(r.event_id)||typeof r.duplicate!=='boolean'||r.revision<pending.expectedRevision+1||(!r.duplicate&&(r.revision!==pending.expectedRevision+1||r.state!==({REQUEST:'REQUESTED',GRANT:'GRANTED',DENY:'DENIED',REVOKE:'REVOKED'})[pending.action])))throw Error();show(r);pending=null;status('Decision recorded. No diagnostic or repair was authorized.');
 }catch(e){if(e.status===409){pending=null;current=null;el('consent-form').hidden=true;el('plan-panel').hidden=true;status('Consent conflict or expiry. Refresh before a new decision.')}else status('Decision not confirmed. Retry the same request or contact IT with request ID '+pending.requestId+'.')}
 finally{busy=false;controls();planControls()}}
 el('consent-form').addEventListener('submit',e=>{e.preventDefault();if(busy||pending||planBusy||planPending||!current||!el('consent-confirm').checked)return;if(typeof crypto.randomUUID!=='function'){status('Secure HTTPS context required.');return}const action=el('consent-action').value;pending=Object.freeze({incidentId,deviceId,requestId:crypto.randomUUID(),expectedRevision:current.revision,action,confirmation:'CONFIRM_'+action+'_DIAGNOSTIC_REVIEW_ONLY'});submit()});
 el('consent-refresh').addEventListener('click',load);el('consent-retry').addEventListener('click',submit);
 const planPath='/api/v1/troubleshooting/diagnostic-review-plan';
 const planStatus=t=>{el('plan-status').textContent=t};
 function planControls(){el('plan-inspect').disabled=planBusy||!!planPending||busy||!!pending;el('plan-create').disabled=planBusy||!!planPending||busy||!!pending;el('plan-retry').hidden=!planPending;el('plan-retry').disabled=planBusy}
 function renderPlan(r){
  if(r.incident_id!==incidentId||r.device_id!==deviceId||r.consent_id!==current.consent_id||r.consent_revision!==current.revision||r.diagnostic_authorized!==false||r.production_accepted!==false||r.diagnostic_id!==current.diagnostic_id||r.execution_authorized!==false||r.repair_authorized!==false||!['PLANNED_ONLY','NOT_PLANNED'].includes(r.state))throw Error();
  if(r.state==='PLANNED_ONLY'){if(!uuid(r.plan_id))throw Error();el('plan-form').hidden=true;planStatus('Plan '+r.plan_id+' recorded for '+r.diagnostic_id+'. No execution authorized.')}
  else{el('plan-form').hidden=false;el('plan-confirm').checked=false;planStatus('No review plan recorded.')}
 }
 el('plan-inspect').addEventListener('click',async()=>{if(planBusy||planPending||busy||pending||!current||current.state!=='GRANTED'||current.expired)return;planBusy=true;planControls();controls();el('plan-form').hidden=true;try{renderPlan(await api(planPath+'?'+new URLSearchParams({incidentId,deviceId})))}catch{planStatus('Plan unavailable. Refresh consent and verify assignment.')}finally{planBusy=false;planControls();controls()}});
 async function submitPlan(){if(planBusy||!planPending||busy||pending)return;planBusy=true;planControls();controls();try{const r=await api(planPath,planPending);if(r.state!=='PLANNED_ONLY'||typeof r.duplicate!=='boolean')throw Error();renderPlan(r);planPending=null}catch(e){if(e.status===409){planPending=null;current=null;el('plan-form').hidden=true;el('plan-panel').hidden=true;el('consent-form').hidden=true;status('Consent must be refreshed.');planStatus('Plan conflict or consent expired. Refresh consent.')}else planStatus('Plan not confirmed. Retry exact request '+planPending.requestId+' or contact IT.')}finally{planBusy=false;planControls();controls()}}
 el('plan-form').addEventListener('submit',e=>{e.preventDefault();if(planBusy||planPending||busy||pending||!current||current.state!=='GRANTED'||current.expired||!el('plan-confirm').checked)return;if(typeof crypto.randomUUID!=='function'){planStatus('Secure HTTPS required.');return}planPending=Object.freeze({incidentId,deviceId,requestId:crypto.randomUUID(),expectedConsentRevision:current.revision,confirmation:'CONFIRM_REVIEW_PLAN_ONLY'});submitPlan()});
 el('plan-retry').addEventListener('click',submitPlan);
 window.addEventListener('beforeunload',e=>{if(pending||planPending){e.preventDefault();e.returnValue=''}});
 (async()=>{try{role=(await api('/api/v1/auth/me')).role;if(!['SUPER_ADMIN','MONITORING'].includes(role))throw Error();await load()}catch{status('Authorized employee or administrator required.')}})();
})();
