// Report-only workflow. Never infer diagnostic/repair permission.
(()=>{
 'use strict';
 const el=id=>document.getElementById(id);
 const token=localStorage.getItem('auth_token');
 if(!token)return;
 const base='/api/v1/troubleshooting/';
 let pending=null,busy=false;
 const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x)&&x.length===36;
 const message=(id,t)=>{el(id).textContent=t};
 async function api(path,body){
  if(localStorage.getItem('auth_token')!==token)throw Error('SESSION_CHANGED');
  const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
   headers:{Accept:'application/json',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(localStorage.getItem('auth_token')!==token)throw Error('SESSION_CHANGED');
  if(!response.ok){const err=Error('REQUEST_NOT_CONFIRMED');err.status=response.status;throw err}
  const data=await response.json();
  if(token!==localStorage.getItem('auth_token'))throw Error('SESSION_CHANGED');
  return data;
 }
 function reportState(){
  el('report-submit').disabled=busy||!!pending||!el('report-device').value;
  el('report-device').disabled=busy||!!pending;
  el('report-consent').disabled=busy||!!pending;
  el('report-retry').hidden=!pending;el('report-retry').disabled=busy;
 }
 async function submitPending(){
  if(busy||!pending)return;busy=true;reportState();
  message('report-status','Submitting report…');
  try{
   const r=await api(base+'employee-report',pending);
   if(!uuid(r.incident_id)||!['OPEN','ESCALATED'].includes(r.status)||r.consent_scope!=='REPORT_ONLY'||r.diagnostic_authorized!==false||r.repair_authorized!==false)throw Error('RECEIPT_NOT_CONFIRMED');
   message('report-status','Report '+r.incident_id+' recorded. Status: '+r.status+'. No diagnostic or repair was authorized.');
   pending=null;el('report-consent').checked=false;
  }catch(e){
   // Keep exactly the same request and consent for retry, including ambiguous
   // network/commit outcomes. Never send a new ID on behalf of the user.
   message('report-status',e.message==='SESSION_CHANGED'?'Session changed. Stop and contact IT before resubmitting.':'Report not confirmed. Retry the same report or contact IT with request ID '+pending.requestId+'. Do not submit a new report for the same incident.');
  }finally{busy=false;reportState()}
 }
 el('report-form').addEventListener('submit',e=>{
  e.preventDefault();if(busy||pending)return;
  const deviceId=el('report-device').value,categoryId=el('category').value,hazard=el('hazard').value;
  if(!uuid(deviceId)||!/^TR-[0-9]{2}$/.test(categoryId)||!el('report-consent').checked){message('report-status','Choose a problem, assigned device and report-only consent.');return}
  if(typeof crypto.randomUUID!=='function'){message('report-status','Secure HTTPS context required for report submission.');return}
  pending=Object.freeze({deviceId,requestId:crypto.randomUUID(),categoryId,hazard,consent:'SUBMIT_REPORT_ONLY'});
  submitPending();
 });
 el('report-retry').addEventListener('click',submitPending);
 el('report-device').addEventListener('change',reportState);
 // Warn before losing the in-page exact retry identity. No persistent browser
 // storage of report details or consent; contact IT if the page was closed.
 window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue=''}});
 el('assignment-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=el('assignment-submit');if(button.disabled)return;
  const deviceId=el('assignment-device').value.trim(),employeeId=Number(el('assignment-user').value),action=el('assignment-action').value;
  if(!uuid(deviceId)||!Number.isSafeInteger(employeeId)||employeeId<1||employeeId>2147483647||!['GRANT','REVOKE'].includes(action)||!el('assignment-confirm').checked){message('assignment-status','Check the exact device, employee and confirmation.');return}
  button.disabled=true;el('assignment-confirm').checked=false;
  try{
   const r=await api(base+'employee-binding',{deviceId,employeeId,action,confirmation:'CONFIRM_'+action+'_REPORT_ONLY'});
   if(!uuid(r.binding_id)||r.scope!=='REPORT_ONLY'||r.state!==(action==='GRANT'?'ACTIVE':'REVOKED')||r.repair_authorized!==false)throw Error('RECEIPT_NOT_CONFIRMED');
   message('assignment-status','Assignment '+r.binding_id+' confirmed: '+r.state+'. Report-only.');
  }catch(e){message('assignment-status','Assignment not confirmed. Check installation binding, authorization and existing assignment state; no success was assumed.')}
  finally{button.disabled=false}
 });
 (async()=>{
  try{
   const me=await api('/api/v1/auth/me');
   if(me.role==='SUPER_ADMIN'){el('assignment-panel').hidden=false;return}
   if(me.role!=='MONITORING')return;
   el('report-panel').hidden=false;reportState();
   const d=await api(base+'employee-devices');
   if(!Array.isArray(d.devices)||d.devices.some(x=>!uuid(x.device_id))||d.scope!=='REPORT_ONLY')throw Error();
   el('report-device').replaceChildren(new Option('Choose assigned device',''),...d.devices.map(x=>new Option(x.device_id,x.device_id)));
   message('report-status',d.devices.length?'Choose an assigned device.':'No active report-only device assignments.');
   reportState();
  }catch{if(!el('report-panel').hidden)message('report-status','Bound reporting unavailable. Contact IT.')}
 })();
})();
