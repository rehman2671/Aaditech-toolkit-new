(()=>{
 'use strict';
 const el=id=>document.getElementById(id),token=localStorage.getItem('auth_token');
 if(!token)return;
 const base='/api/v1/troubleshooting/';
 let admin=false,cursor=null,busy=false,pending=null,categories=new Map(),generation=0,filters={};
 const status=t=>{el('review-status').textContent=t};
 const uuid=x=>typeof x==='string'&&x.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
 async function api(path,body){
  if(localStorage.getItem('auth_token')!==token)throw Error('SESSION_CHANGED');
  const r=await fetch(path,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(localStorage.getItem('auth_token')!==token)throw Error('SESSION_CHANGED');
  if(!r.ok){const e=Error('REQUEST_NOT_CONFIRMED');e.status=r.status;throw e}
  return r.json();
 }
 const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n};
 function controls(){
  for(const b of el('review-panel').querySelectorAll('button,input,select'))b.disabled=busy||!!pending;
  el('review-retry').hidden=!pending;el('review-retry').disabled=busy;
  el('review-more').hidden=!cursor;
 }
 function render(r){
  if(!uuid(r.incident_id)||!uuid(r.device_id)||!Number.isSafeInteger(r.revision)||r.verified_resolved!==false)throw Error();
  const card=node('article','');card.className='incident-card';
  card.append(node('h3',categories.get(r.category_id)||r.category_id),node('p','Incident: '+r.incident_id),node('p','Device: '+r.device_id),node('p','Intake: '+r.intake_status+' | Hazard: '+r.hazard),node('p','Human review: '+r.review_state+' | Revision: '+r.revision));
  if(admin&&Array.isArray(r.allowed_transitions)&&r.allowed_transitions.length){
   const f=document.createElement('form'),select=document.createElement('select'),label=node('label','Next human review state');
   select.setAttribute('aria-label','Next state for incident '+r.incident_id);
   select.replaceChildren(...r.allowed_transitions.map(s=>new Option(s.replaceAll('_',' '),s)));
   const confirm=document.createElement('input');confirm.type='checkbox';confirm.required=true;
   const consent=node('label','');consent.className='check';consent.append(confirm,document.createTextNode('Confirm human review change only'));
   const b=node('button','Update review');b.type='submit';f.append(label,select,consent,b);
   f.addEventListener('submit',e=>{
    e.preventDefault();if(busy||pending||!confirm.checked)return;
    if(typeof crypto.randomUUID!=='function'){status('Secure HTTPS context required.');return}
    pending=Object.freeze({incidentId:r.incident_id,deviceId:r.device_id,requestId:crypto.randomUUID(),expectedRevision:r.revision,nextState:select.value,confirmation:'CONFIRM_HUMAN_REVIEW_ONLY'});submit();
   });card.append(f);
  }
  if(r.hazard_assessment?.assessment_state==='RECORDED')card.append(node('p','Human screening: '+r.hazard_assessment.assessment+' (not verified safety)'+(r.hazard_assessment.human_referral_required?' — qualified human referral required.':'')));
  if(admin&&r.intake_status==='OPEN'&&r.hazard==='UNKNOWN'){
   const link=node('a','Inspect or record hazard screening');link.href='/hazard-assessment.html?'+new URLSearchParams({incidentId:r.incident_id,deviceId:r.device_id});card.append(link);
  }
  if(r.intake_status==='OPEN'&&r.hazard==='NONE'){
   const link=node('a','Diagnostic review consent');link.href='/diagnostic-consent.html?'+new URLSearchParams({incidentId:r.incident_id,deviceId:r.device_id});card.append(link);
  }
  return card;
 }
 async function load(next=false){
  if(busy||pending)return;
  busy=true;const id=++generation;controls();status('Loading reports…');
  if(!next){cursor=null;el('review-list').replaceChildren()}
  try{
   const q=new URLSearchParams({...filters,...(next&&cursor?{after:cursor}:{})});
   const doc=await api(base+(admin?'review-queue':'my-reports')+'?'+q);
   if(id!==generation)return;
   if(!Array.isArray(doc.items)||doc.items.length>50||(doc.next_cursor!==null&&!uuid(doc.next_cursor)))throw Error();
   const items=doc.items.map(render);el('review-list').append(...items);cursor=doc.next_cursor;
   status(items.length?'Reports loaded. No verified outcome is implied.':next?'No more reports.':'No matching reports.');
  }catch{if(id===generation){cursor=null;el('review-list').replaceChildren();status('Report queue unavailable. Sign in again or contact IT.')}}finally{busy=false;controls()}
 }
 async function submit(){
  if(busy||!pending)return;busy=true;controls();status('Saving human review…');
  try{
   const r=await api(base+'review-transition',pending);
   if(r.incident_id!==pending.incidentId||!uuid(r.event_id)||r.review_state!==pending.nextState||r.revision!==pending.expectedRevision+1||r.verified_resolved!==false)throw Error();
   pending=null;busy=false;await load();status('Human review change recorded. No resolution or repair was verified.');
  }catch(e){if(e.status===409){pending=null;status('Review conflict. Refresh before making a new change.')}else status('Review change unconfirmed. Retry the same request or contact IT with request ID '+pending.requestId+'.')}
  finally{busy=false;controls()}
 }
 el('review-filters').addEventListener('submit',e=>{e.preventDefault();if(busy||pending)return;const deviceId=el('review-device').value.trim();if(deviceId&&!uuid(deviceId)){status('Enter an exact device UUID.');return}filters={category:el('review-category').value,status:el('review-intake').value,deviceId};load()});
 el('review-refresh').addEventListener('click',()=>load());el('review-more').addEventListener('click',()=>load(true));el('review-retry').addEventListener('click',submit);
 window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue=''}});
 (async()=>{try{
  const me=await api('/api/v1/auth/me');admin=me.role==='SUPER_ADMIN';if(!admin&&me.role!=='MONITORING')return;
  const catalog=await api(base+'catalog');categories=new Map(catalog.categories.map(x=>[x.id,x.title]));
  el('review-category').append(...catalog.categories.map(x=>new Option(x.title,x.id)));
  el('review-title').textContent=admin?'Technician incident review queue':'My assigned-device reports';
  el('review-filters').hidden=!admin;el('review-panel').hidden=false;await load();
 }catch{}})();
})();
