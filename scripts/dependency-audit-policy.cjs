'use strict';
// Online audit only; never run npm audit fix or expose registry output, paths,
// tokens, advisory text or URLs. No dependency or lockfile mutation.
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {readFileSync,mkdtempSync,writeFileSync,rmSync,chmodSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {resolve,join}=require('node:path');
const root=resolve(__dirname,'..');
const levels=['info','low','moderate','high','critical'];
const plain=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
const pkgName=x=>typeof x==='string'&&x.length<=214&&/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(x)&&!/[\r\n]/.test(x);
function summarizeAudit(raw,status){
 if(![0,1].includes(status)||typeof raw!=='string'||raw.length>8*1024*1024)throw Error('AUDIT_UNVERIFIED');
 let d;try{d=JSON.parse(raw)}catch{throw Error('AUDIT_UNVERIFIED')}
 if(!plain(d)||d.auditReportVersion!==2||Object.hasOwn(d,'error')||!plain(d.vulnerabilities)||!plain(d.metadata?.vulnerabilities))throw Error('AUDIT_UNVERIFIED');
 const counts=Object.fromEntries(levels.map(k=>[k,0])),rows=[];
 for(const [name,v] of Object.entries(d.vulnerabilities)){
  if(!pkgName(name)||!plain(v)||v.name!==name||!levels.includes(v.severity)||typeof v.isDirect!=='boolean'||!Array.isArray(v.via)||!v.via.length||!Array.isArray(v.nodes)||!v.nodes.length||!(typeof v.fixAvailable==='boolean'||plain(v.fixAvailable)))throw Error('AUDIT_UNVERIFIED');
  const advisoryIds=[],viaPackages=[];
  for(const item of v.via){
   if(typeof item==='string'){if(!pkgName(item))throw Error('AUDIT_UNVERIFIED');viaPackages.push(item)}
   else if(plain(item)&&Number.isSafeInteger(item.source)&&item.source>0)advisoryIds.push(item.source);
   else throw Error('AUDIT_UNVERIFIED');
  }
  let fix=null;
  if(plain(v.fixAvailable)){
   const f=v.fixAvailable;if(!pkgName(f.name)||typeof f.version!=='string'||f.version.length>80||!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(f.version)||typeof f.isSemVerMajor!=='boolean')throw Error('AUDIT_UNVERIFIED');
   fix={package:f.name,version:f.version,major_change:f.isSemVerMajor};
  }
  counts[v.severity]++;rows.push({package:name,severity:v.severity,direct:v.isDirect,advisory_ids:[...new Set(advisoryIds)].sort((a,b)=>a-b),via_packages:[...new Set(viaPackages)].sort(),fix_available:v.fixAvailable!==false,fix_candidate:fix});
 }
 const total=rows.length,declared=d.metadata.vulnerabilities;
 if(levels.some(k=>!Number.isSafeInteger(declared[k])||declared[k]!==counts[k])||declared.total!==total||(status===0&&total>0)||(status===1&&total===0))throw Error('AUDIT_UNVERIFIED');
 rows.sort((a,b)=>levels.indexOf(b.severity)-levels.indexOf(a.severity)||a.package.localeCompare(b.package));
 return {status:'VERIFIED_REPORT',counts:{...counts,total},packages:rows};
}
function releaseAllowed(prod,full){
 return prod?.status==='VERIFIED_REPORT'&&full?.status==='VERIFIED_REPORT'&&prod.counts?.critical===0&&prod.counts?.high===0;
}
// npm rejects loading the same path for two config sources, including /dev/null.
// Isolate both config files, HOME and cache; never inherit auth or registry overrides.
function withIsolatedNpmConfig(fn){
 const dir=mkdtempSync(join(tmpdir(),'aaditech-npm-audit-'));
 try{
  chmodSync(dir,0o700);
  const user=join(dir,'user.npmrc'),global=join(dir,'global.npmrc');
  for(const file of [user,global])writeFileSync(file,'',{mode:0o600,flag:'wx'});
  return fn({PATH:process.env.PATH,HOME:dir,CI:'true',NPM_CONFIG_USERCONFIG:user,NPM_CONFIG_GLOBALCONFIG:global,NPM_CONFIG_CACHE:join(dir,'cache')});
 }finally{rmSync(dir,{recursive:true,force:true})}
}
function collect(scope){
 const args=['audit','--json','--audit-level=info','--ignore-scripts','--package-lock-only','--registry=https://registry.npmjs.org/','--fetch-retries=1','--fetch-timeout=20000'];
 if(scope==='production')args.push('--omit=dev');
 return withIsolatedNpmConfig(env=>{
  const r=spawnSync('npm',args,{cwd:root,encoding:'utf8',timeout:65000,maxBuffer:8*1024*1024,env});
  if(r.error||r.signal)return {status:'UNVERIFIED',reason:'AUDIT_PROCESS_UNAVAILABLE'};
  if(![0,1].includes(r.status))return {status:'UNVERIFIED',reason:'AUDIT_EXIT_UNEXPECTED'};
  try{return summarizeAudit(r.stdout,r.status)}catch{
   let d;try{d=JSON.parse(r.stdout)}catch{return {status:'UNVERIFIED',reason:'AUDIT_OUTPUT_INVALID'}}
   return {status:'UNVERIFIED',reason:d?.error?'AUDIT_REGISTRY_OR_CONFIGURATION_ERROR':'AUDIT_SCHEMA_UNVERIFIED'};
  }
 });
}
function main(){
 if(process.platform!=='linux'||process.argv.length!==3||!['--report','--release'].includes(process.argv[2]))throw Error('AUDIT_POLICY_INPUT_INVALID');
 const lock=resolve(root,'package-lock.json'),digest=()=>createHash('sha256').update(readFileSync(lock)).digest('hex');
 const before=digest(),production=collect('production'),all=collect('all');
 if(before!==digest())throw Error('AUDIT_LOCK_CHANGED');
 const allowed=releaseAllowed(production,all);
 console.log(JSON.stringify({schema_version:1,lock_sha256:before,production,all,protected_release_audit_passed:allowed,dependency_remediation_performed:false,production_accepted:false}));
 if(process.argv[2]==='--release'&&!allowed)process.exitCode=1;
}
if(require.main===module){try{main()}catch{console.error('Dependency audit unavailable or policy invalid; no release authorization.');process.exitCode=1}}
module.exports={summarizeAudit,releaseAllowed,withIsolatedNpmConfig};
