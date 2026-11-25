(()=>{
 'use strict';
 const el=id=>document.getElementById(id),token=localStorage.getItem('auth_token'),q=new URLSearchParams(location.search),incidentId=q.get('incidentId'),deviceId=q.get('deviceId');
 const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
 const status=t=>{el('consent-status').textContent=t};
 if(!token||!uuid(incidentId)||!uuid(deviceId)||[...q.keys()].length!==2){status('Sign in and open an eligible incident from the reports page.');return}
 let role,current=null,pending=null,busy=false;
 const path='/api/v1/troubleshooting/diagnostic-consent';
 async function api(url,body){
  if(token!==localStorage.getItem('auth_token'))throw Error('SESSION_CHANGED');
  const r=await fetch(url,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(token!==localStorage.getItem('auth_token'))throw Error('SESSION_CHANGED');
  if(!r.ok){const e=Error();e.status=r.status;throw e}return r.json();
 }
 function controls(){
  for(const id of ['consent-action','consent-confirm','consent-save','consent-refresh'])el(id).disabled=busy||!!pending;
  el('consent-retry').hidden=!pending;el('consent-retry').disabled=busy;
 }
 function show(r){
  if(r.incident_id!==incidentId||r.device_id!==deviceId||!Number.isSafeInteger(r.revision)||!['NOT_REQUESTED','REQUESTED','GRANTED','DENIED','REVOKED'].includes(r.state)||r.scope!=='REVIEW_ONLY'||r.execution_authorized!==false||r.repair_authorized!==false)throw Error();
  current=r;el('consent-details').replaceChildren();
  for(const [k,v] of [['Incident',incidentId],['Device',deviceId],['Diagnostic category',r.diagnostic_id],['State',r.state],['Expired',r.expired?'Yes':'No']]){
   const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;el('consent-details').append(dt,dd)
  }
  const actions=role==='SUPER_ADMIN'&&r.state==='NOT_REQUESTED'?['REQUEST']:role==='MONITORING'&&r.state==='REQUESTED'&&!r.expired?['GRANT','DENY']:role==='MONITORING'&&r.state==='GRANTED'?['REVOKE']:[];
  el('consent-action').replaceChildren(...actions.map(a=>new Option(a,a)));el('consent-confirm').checked=false;el('consent-form').hidden=!actions.length;el('consent-panel').hidden=false;
 }
 async function load(){if(busy||pending)return;busy=true;controls();try{show(await api(path+'?'+new URLSearchParams({incidentId,deviceId})));status('Consent status loaded.')}catch{el('consent-panel').hidden=true;status('Consent unavailable or incident not eligible. No action was authorized.')}finally{busy=false;controls()}}
 async function submit(){if(busy||!pending)return;busy=true;controls();try{
  const r=await api(path,pending);if(!uuid(r.event_id))throw Error();show(r);pending=null;status('Decision recorded. No diagnostic or repair was authorized.');
 }catch(e){if(e.status===409){pending=null;status('Consent conflict or expiry. Refresh before a new decision.')}else status('Decision not confirmed. Retry the same request or contact IT with request ID '+pending.requestId+'.')}
 finally{busy=false;controls()}}
 el('consent-form').addEventListener('submit',e=>{e.preventDefault();if(busy||pending||!current||!el('consent-confirm').checked)return;if(typeof crypto.randomUUID!=='function'){status('Secure HTTPS context required.');return}const action=el('consent-action').value;pending=Object.freeze({incidentId,deviceId,requestId:crypto.randomUUID(),expectedRevision:current.revision,action,confirmation:'CONFIRM_'+action+'_DIAGNOSTIC_REVIEW_ONLY'});submit()});
 el('consent-refresh').addEventListener('click',load);el('consent-retry').addEventListener('click',submit);
 window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue=''}});
 (async()=>{try{role=(await api('/api/v1/auth/me')).role;if(!['SUPER_ADMIN','MONITORING'].includes(role))throw Error();await load()}catch{status('Authorized employee or administrator required.')}})();
})();
