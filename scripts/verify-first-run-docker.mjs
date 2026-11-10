#!/usr/bin/env node
// End-to-end test: real Docker API + MySQL, production runtime, persistent volume.
// Must run in a disposable CI Docker Compose project, never against production.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const base=process.env.PHASE_H_BASE_URL||'http://127.0.0.1:3000';
const envFile=process.env.PHASE_H_ENV_FILE||'Enterprise/.env';
const compose=['compose','--env-file',envFile,'-f','Enterprise/docker-compose.yml'];
const sleep=ms=>new Promise(done=>setTimeout(done,ms));

async function api(path,init={}) {
  const r=await fetch(base+path,{...init,headers:{'Content-Type':'application/json',...(init.headers||{})},signal:AbortSignal.timeout(10000)});
  let body={};
  try{body=await r.json();}catch{}
  return {status:r.status,body,headers:r.headers};
}
function composeExec(...args) {
  return execFileSync('docker',[...compose,...args],{encoding:'utf8',timeout:120000});
}
async function waitReady(timeoutMs=100000) {
  const stop=Date.now()+timeoutMs;
  while(Date.now()<stop) {
    try {
      const result=await api('/api/setup/status');
      if(result.status===200&&result.body.database_connected===true)return result.body;
    }catch{}
    await sleep(1600);
  }
  throw new Error('Server did not report MySQL-ready setup state within '+timeoutMs+'ms');
}

const setupCode=composeExec('exec','-T','api','cat','/data/first-run-setup-code').trim();
assert.ok(setupCode.length>28,'Host setup code is generated and persisted');
const initial=await waitReady();
assert.equal(initial.setup_complete,false,'A new database needs first-run setup');

const payload={
  company_name:'Aaditech CI Test Organization',
  server_host:'localhost',
  admin_username:'ci_admin',
  admin_email:'ci_admin@example.com',
  admin_password:'TestUniqueAdminPassword2026!',
  branding:{color:'#38bdf8',logo_text:'Aaditech CI Test'},
  build_mode:'manual',github_repo:'',
  smtp:{provider:'none'}
};
const bad=await api('/api/setup',{method:'POST',headers:{'X-Setup-Code':'incorrect'},body:JSON.stringify(payload)});
assert.equal(bad.status,403,'An invalid host-local code is rejected');

const weak=await api('/api/setup',{method:'POST',headers:{'X-Setup-Code':setupCode},body:JSON.stringify({...payload,admin_password:'short'})});
assert.equal(weak.status,400,'A weak password fails schema validation');

const created=await api('/api/setup',{method:'POST',headers:{'X-Setup-Code':setupCode},body:JSON.stringify(payload)});
assert.equal(created.status,200,'First-run setup succeeded; received '+created.status+' '+JSON.stringify(created.body));
assert.equal(created.body.setup_complete,true);

const completed=await api('/api/setup/status');
assert.equal(completed.status,200);
assert.equal(completed.body.setup_complete,true,'Setup state persisted in MySQL');

const duplicate=await api('/api/setup',{method:'POST',headers:{'X-Setup-Code':setupCode},body:JSON.stringify(payload)});
assert.notEqual(duplicate.status,200,'An unauthenticated second setup cannot replace the owner');

const defaultLogin=await api('/api/v1/auth/login',{method:'POST',
  body:JSON.stringify({username:'admin',password:'Admin123!'})});
assert.notEqual(defaultLogin.status,200,'Seeded default administrator credentials no longer work');

const opsLogin=await api('/api/v1/auth/login',{method:'POST',
  body:JSON.stringify({username:'ops_lead',password:'Operator123!'})});
assert.notEqual(opsLogin.status,200,'Untouched default operator disabled');

async function login() {
  const result=await api('/api/v1/auth/login',{method:'POST',
    body:JSON.stringify({username:payload.admin_username,password:payload.admin_password})});
  assert.equal(result.status,200,'New administrator can sign in: '+JSON.stringify(result.body));
  assert.ok(result.body.token,'Admin JWT present');
  return result.body.token;
}
const token=await login();
const auth={'Authorization':'Bearer '+token};
const anonymous=await api('/api/v1/system/config');
assert.equal(anonymous.status,401,'Anonymous configuration read blocked');
const before=await api('/api/v1/system/config',{headers:auth});
assert.equal(before.status,200,'Admin can read configuration');
assert.equal(before.body.company_name,payload.company_name);
assert.equal(before.body.github_token_configured,false);
assert.ok(!JSON.stringify(before.body).includes(payload.admin_password),'API never exposes password');

const newHost='ci.example.invalid';
const edit=await api('/api/v1/system/config',{
  method:'PATCH',headers:auth,
  body:JSON.stringify({company_name:'Aaditech Updated CI',server_host:newHost})
});
assert.equal(edit.status,200,'Admin can persist settings: '+JSON.stringify(edit.body));
const after=await api('/api/v1/system/config',{headers:auth});
assert.equal(after.body.company_name,'Aaditech Updated CI');
assert.equal(after.body.server_host,newHost);

const dbTest=await api('/api/v1/system/config/test',{method:'POST',
  headers:auth,body:JSON.stringify({kind:'database'})});
assert.equal(dbTest.status,200,'MySQL test succeeds with a live DB');

const emailTest=await api('/api/v1/system/config/test',{method:'POST',
  headers:auth,body:JSON.stringify({kind:'smtp'})});
assert.equal(emailTest.status,501,'Unimplemented SMTP test must not fake success');

composeExec('restart','api');
await waitReady();
const tokenAfterRestart=await login();
const saved=await api('/api/v1/system/config',{headers:{Authorization:'Bearer '+tokenAfterRestart}});
assert.equal(saved.status,200);
assert.equal(saved.body.server_host,newHost,'Settings survive container restart');
const setupAfterRestart=composeExec('exec','-T','api','cat','/data/first-run-setup-code').trim();
assert.equal(setupAfterRestart,setupCode,'Host setup code remains stable across restart');

console.log('[Phase H] PASS: fresh MySQL setup, one-time ownership, role protection, editable settings, persistence, restart.');
