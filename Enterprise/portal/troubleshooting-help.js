'use strict';
const el=id=>document.getElementById(id);
const form=el('help-form'),status=el('status'),category=el('category'),result=el('result');
let items=[],last=null,sequence=0;
const statusText=t=>{status.textContent=t};
function clear(){sequence++;last=null;result.hidden=true;el('steps').replaceChildren();el('submit').disabled=!category.value;}
async function get(path){
 const token=localStorage.getItem('auth_token');
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})}});
 if(response.status===401||response.status===403)throw Error('SIGN_IN');
 if(!response.ok)throw Error('HELP_UNAVAILABLE');
 return response.json();
}
function filter(){
 const term=el('search').value.trim().toLowerCase(),previous=category.value;
 const matches=items.filter(x=>(x.title+' '+x.category.replaceAll('_',' ')).toLowerCase().includes(term));
 category.replaceChildren(new Option('Choose a problem',''),...matches.map(x=>new Option(x.title,x.id)));
 if(matches.some(x=>x.id===previous))category.value=previous;
 clear();statusText(matches.length?matches.length+' matching problems.':'No matching problem. Try a different search.');
}
function render(doc){
 const g=doc.guidance;last=g;
 el('result-title').textContent=g.title;
 el('risk').textContent=g.guidance_type==='HUMAN_ONLY'?'Stop and seek qualified support':g.guidance_type==='HAZARD_ASSESSMENT'?'Safety assessment required':'Advisory guidance only';
 el('risk').dataset.urgent=String(g.guidance_type==='HUMAN_ONLY');
 el('steps').replaceChildren(...g.instructions.map(s=>{const li=document.createElement('li');li.textContent=s;return li}));
 el('success').textContent=g.success_check;
 const cap=doc.capability;
 el('capability').textContent=cap?'Diagnostic availability: '+cap.availability.replaceAll('_',' ').toLowerCase()+'. Platform acceptance and execution are not authorized.':'Diagnostic collection is not offered for this assessment.';
 result.hidden=false;statusText('Guidance ready.');
}
el('search').addEventListener('input',filter);
for(const id of ['category','hazard','platform'])el(id).addEventListener('change',clear);
form.addEventListener('submit',async event=>{
 event.preventDefault();clear();const id=++sequence;el('submit').disabled=true;statusText('Loading guidance…');
 const q=new URLSearchParams({category_id:category.value,hazard:el('hazard').value,platform:el('platform').value});
 try{const doc=await get('/api/v1/troubleshooting/help?'+q);if(id===sequence)render(doc)}
 catch(e){if(id===sequence)statusText(e.message==='SIGN_IN'?'Session expired. Return to the portal and sign in.':'Guidance unavailable. Contact IT if the issue is urgent.')}
 finally{if(id===sequence)el('submit').disabled=!category.value}
});
el('copy').addEventListener('click',async()=>{
 if(!last)return;
 const text=[last.title,...last.instructions,'Expected outcome: '+last.success_check,'Advisory only; no repair or verified resolution.'].join('\n');
 try{await navigator.clipboard.writeText(text);statusText('Guidance copied.')}
 catch{statusText('Copy unavailable. Select and copy the displayed guidance manually.')}
});
(async()=>{try{const doc=await get('/api/v1/troubleshooting/catalog');items=doc.categories;form.hidden=false;filter()}
 catch(e){statusText(e.message==='SIGN_IN'?'Sign in through the portal to access help.':'Help catalog unavailable. Contact IT for assistance.')}})();
