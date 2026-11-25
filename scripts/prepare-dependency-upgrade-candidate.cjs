'use strict';
// Resolve compatible npm fixes in a private scratch directory on disposable CI.
// No package installation, lifecycle scripts, --force, repository changes,
// automatic commit, release authorization or raw npm output.
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {readFileSync,writeFileSync,mkdtempSync,rmSync,chmodSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {tmpdir}=require('node:os');
const {withIsolatedNpmConfig,summarizeAudit}=require('./dependency-audit-policy.cjs');
const root=resolve(__dirname,'..'),limit=8*1024*1024;
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=reason=>{throw Error(reason)};
const plain=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(plain(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
const name='(?:@[a-zA-Z0-9._-]+/)?[a-zA-Z0-9][a-zA-Z0-9._-]*';
const pathPattern=new RegExp('^node_modules/'+name+'(?:/node_modules/'+name+')*$');
const version=x=>typeof x==='string'&&x.length<=100&&/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(x);
const fields=new Set(['name','version','engines','dependencies','resolved','integrity','dev','license','bin','funding','peer','peerDependenciesMeta','cpu','optional','os','peerDependencies','hasInstallScript','optionalDependencies','devOptional','libc','bundleDependencies','inBundle','deprecated']);
function safeValue(value,depth=0){
 if(depth>10)return false;
 if(value===null||typeof value==='boolean')return true;
 if(typeof value==='string')return value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value);
 if(Array.isArray(value))return value.length<=1000&&value.every(v=>safeValue(v,depth+1));
 return plain(value)&&Object.keys(value).length<=1000&&Object.entries(value).every(([k,v])=>k.length<=512&&!/[\x00-\x1f\x7f]/.test(k)&&!['__proto__','constructor','prototype'].includes(k)&&safeValue(v,depth+1));
}
function registryIntegrity(row){
 if(typeof row.resolved!=='string'||row.resolved.length>2048||typeof row.integrity!=='string'||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(row.integrity))return false;
 try{const u=new URL(row.resolved);return u.origin==='https://registry.npmjs.org'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.href===row.resolved&&u.pathname.endsWith('.tgz')}catch{return false}
}
function buildDependencyDelta(before,after){
 if(!plain(before)||!plain(after)||before.lockfileVersion!==3||after.lockfileVersion!==3||!plain(before.packages)||!plain(after.packages))fail('LOCK_SCHEMA_UNVERIFIED');
 const top=x=>Object.fromEntries(Object.entries(x).filter(([k])=>k!=='packages'));
 if(canonical(top(before))!==canonical(top(after))||canonical(before.packages[''])!==canonical(after.packages['']))fail('DIRECT_DEPENDENCY_POLICY_CHANGED');
 const keys=[...new Set([...Object.keys(before.packages),...Object.keys(after.packages)])].filter(Boolean).sort();
 if(keys.length>10000)fail('LOCK_LIMIT_EXCEEDED');
 const changes=[];
 for(const k of keys){
  if(k.length>512||!pathPattern.test(k))fail('PACKAGE_PATH_UNVERIFIED');
  const old=before.packages[k],next=after.packages[k];
  if(canonical(old)===canonical(next))continue;
  if(next!==undefined){
   if(!plain(next)||!version(next.version)||Object.keys(next).some(f=>!fields.has(f))||!safeValue(next))fail('PACKAGE_METADATA_UNVERIFIED');
   if((!old||old.version!==next.version||old.resolved!==next.resolved||old.integrity!==next.integrity)&&!registryIntegrity(next))fail('PACKAGE_REGISTRY_INTEGRITY_UNVERIFIED');
  }
  changes.push({path:k,previous_version:old?.version??null,entry:next??null});
 }
 if(changes.length>500||Buffer.byteLength(JSON.stringify(changes))>512*1024)fail('DELTA_LIMIT_EXCEEDED');
 return {changes,candidate_canonical_sha256:sha(canonical(after))};
}
function callNpm(cwd,args){
 return withIsolatedNpmConfig(env=>spawnSync('npm',[...args,'--ignore-scripts','--registry=https://registry.npmjs.org/','--fetch-retries=1','--fetch-timeout=20000'],{cwd,env,encoding:'utf8',timeout:90000,maxBuffer:limit}));
}
function report(cwd,production){
 const r=callNpm(cwd,['audit','--json','--audit-level=info','--package-lock-only',...(production?['--omit=dev']:[])]);
 if(r.error||r.signal)fail('CANDIDATE_AUDIT_UNAVAILABLE');
 return summarizeAudit(r.stdout,r.status);
}
function main(){
 if(process.argv.length!==2||process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.GITHUB_EVENT_NAME!=='pull_request')fail('DISPOSABLE_PR_CI_REQUIRED');
 const manifest=readFileSync(join(root,'package.json')),lock=readFileSync(join(root,'package-lock.json')),base=sha(lock);
 if(manifest.length>limit||lock.length>limit)fail('LOCK_LIMIT_EXCEEDED');
 const dir=mkdtempSync(join(tmpdir(),'aaditech-upgrade-candidate-'));
 try{
  chmodSync(dir,0o700);writeFileSync(join(dir,'package.json'),manifest,{mode:0o600,flag:'wx'});writeFileSync(join(dir,'package-lock.json'),lock,{mode:0o600,flag:'wx'});
  const r=callNpm(dir,['audit','fix','--package-lock-only','--json','--audit-level=info','--no-fund']);
  if(r.error||r.signal||![0,1].includes(r.status))fail('COMPATIBLE_RESOLUTION_UNAVAILABLE');
  const candidate=readFileSync(join(dir,'package-lock.json'));
  if(candidate.length>limit||!manifest.equals(readFileSync(join(dir,'package.json'))))fail('DIRECT_DEPENDENCY_POLICY_CHANGED');
  const delta=buildDependencyDelta(JSON.parse(lock),JSON.parse(candidate));
  const production=report(dir,true),all=report(dir,false);
  if(!candidate.equals(readFileSync(join(dir,'package-lock.json')))||!manifest.equals(readFileSync(join(dir,'package.json')))||!lock.equals(readFileSync(join(root,'package-lock.json')))||!manifest.equals(readFileSync(join(root,'package.json'))))fail('CANDIDATE_INPUT_CHANGED');
  console.log(JSON.stringify({event:'DEPENDENCY_CANDIDATE_SUMMARY',base_lock_sha256:base,candidate_canonical_sha256:delta.candidate_canonical_sha256,changed_entries:delta.changes.length,production,all,repository_changed:false,installation_performed:false,release_authorized:false}));
  // Each entry can be reconstructed from the verified base and canonical
  // digest. These are candidate package-lock records, not trusted commands.
  for(const entry of delta.changes)console.log(JSON.stringify({event:'DEPENDENCY_CANDIDATE_ENTRY',...entry}));
 }finally{rmSync(dir,{recursive:true,force:true})}
}
if(require.main===module){try{main()}catch(e){const code=/^[A-Z_]{1,80}$/.test(e?.message??'')?e.message:'CANDIDATE_UNAVAILABLE';console.log(JSON.stringify({event:'DEPENDENCY_CANDIDATE_UNAVAILABLE',reason:code,repository_changed:false,release_authorized:false}))}}
module.exports={buildDependencyDelta,canonical};
