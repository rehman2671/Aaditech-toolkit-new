(()=>{
 'use strict';
 const el=id=>document.getElementById(id),token=localStorage.getItem('auth_token');
 const status=t=>{el('config-status').textContent=t};
 if(!token){status('Sign in through the portal first.');return}
 async function api(path,body){
  if(token!==localStorage.getItem('auth_token'))throw Error();
  const r=await fetch(path,{method:body?'PUT':'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(token!==localStorage.getItem('auth_token'))throw Error();
  if(!r.ok){const e=Error();e.status=r.status;throw e}const data=await r.json();
  if(token!==localStorage.getItem('auth_token'))throw Error('SESSION_CHANGED');
  return data;
 }
 function fill(b){el('company').value=b.company_name||'';el('logo').value=b.logo_text||'';el('color').value=/^#[0-9a-fA-F]{6}$/.test(b.color)?b.color:'#38bdf8'}
 const path='/api/v1/workspaces/branding';
 async function runtime(){
  const button=el('refresh');button.disabled=true;el('runtime-values').replaceChildren();
  try{
   const d=await api('/api/v1/platform/runtime-configuration');
   const rows=[['Configured host',d.configured_server_host||'Not configured'],['Database reachability',d.database_reachable===true?'Observed reachable':'Not verified'],['Latest recorded migration',d.latest_recorded_migration||'Unknown'],['Report identity binding',d.report_identity_state],['Agent origin policy',d.agent_origin_policy],['Production acceptance','Not verified']];
   for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);el('runtime-values').append(dt,dd)}
   el('runtime-config').hidden=false;
  }catch(e){if(e.status!==403)status('Runtime configuration unavailable.');el('runtime-config').hidden=true}
  finally{button.disabled=false}
 }
 el('refresh').addEventListener('click',runtime);
 el('workspace-form').addEventListener('submit',async e=>{
  e.preventDefault();const btn=el('save');if(btn.disabled)return;btn.disabled=true;
  const body={company_name:el('company').value.trim(),logo_text:el('logo').value.trim(),color:el('color').value};
  try{await api(path,body);const observed=await api(path);if(!observed||Object.keys(body).some(k=>observed[k]!==body[k]))throw Error();fill(observed);status('Workspace settings saved and read back.')}
  catch{el('workspace-config').hidden=true;status('Settings change not confirmed. Reopen configuration before retrying.')}
  finally{btn.disabled=false}
 });
 (async()=>{try{const me=await api('/api/v1/auth/me');if(me.role!=='SUPER_ADMIN'){status('Workspace administrator access required.');return}fill(await api(path));el('workspace-config').hidden=false;status('Workspace configuration loaded.');await runtime()}catch{status('Configuration unavailable. Sign in again or contact IT.')}})();
})();
