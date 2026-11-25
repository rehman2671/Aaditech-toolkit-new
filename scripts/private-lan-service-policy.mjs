// Protected service candidate only. Never install or enable a systemd unit,
// execute systemctl, rotate pins, or authorize a restarted Docker stack.
import {constants} from 'node:fs';
import {lstat,realpath,readdir,open} from 'node:fs/promises';
import {resolve,relative,dirname,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {validateExistingLanForwarderPolicy} from './private-lan-forwarder.mjs';
import {inspectLivePrivateStack} from './create-stopped-compose-candidates.mjs';
const fail=()=>{throw Error('PRIVATE_LAN_SERVICE_POLICY_UNCONFIRMED')};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$(?![\s\S])/.test(x)&&!/^0+$/.test(x);
const pathOk=x=>typeof x==='string'&&x.length>1&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&/^\/[A-Za-z0-9_./-]+$(?![\s\S])/.test(x);
const within=(a,b)=>{const q=relative(a,b);return q===''||!isAbsolute(q)&&q!=='..'&&!q.startsWith('../')};
const overlap=(a,b)=>within(a,b)||within(b,a);
const dirFields=['dev','ino','uid','gid','mode'],fileFields=[...dirFields,'nlink','size','mtimeMs','ctimeMs'];
const same=(a,b,keys)=>keys.every(k=>a[k]===b[k]);
const policyName='forwarder-policy.json',unitName='aaditech-private-lan-forwarder.service';
const runtime='/opt/aaditech/runtime',runner=runtime+'/scripts/run-private-lan-service-cli.mjs';
const node='/usr/bin/node';
export function renderPrivateLanServiceUnit({policyDirectory,policySha256,adapterLockRoot}){
 if(!pathOk(policyDirectory)||!pathOk(adapterLockRoot)||!hex(policySha256)||overlap(policyDirectory,adapterLockRoot)||[policyDirectory,adapterLockRoot].some(x=>overlap(x,runtime)||overlap(x,'/var/lib/docker')||overlap(x,'/run/docker.sock')))fail();
 // No Install section, automatic start, restart, ambient environment input
 // or shell. Explicit start only after independent operator unit approval.
 // Root is currently required for read-only Docker and identity verification.
 return [
 '[Unit]','Description=AadiTech pinned private LAN forwarder','After=network-online.target docker.service','Wants=network-online.target','Requires=docker.service','',
 '[Service]','Type=exec','User=root','Group=root','WorkingDirectory='+runtime,
 'ExecStart='+node+' '+runner+' --run-pinned-service '+policyDirectory+'/'+policyName+' '+policySha256,
 'Restart=no','TimeoutStopSec=20s','KillMode=control-group','UMask=0077',
 'NoNewPrivileges=yes','PrivateTmp=yes','ProtectSystem=strict','ProtectHome=read-only',
 'ReadWritePaths='+adapterLockRoot,'ProtectKernelTunables=yes','ProtectKernelModules=yes','ProtectControlGroups=yes',
 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK','RestrictSUIDSGID=yes','LockPersonality=yes',
 'Environment=NODE_OPTIONS=','Environment=NODE_PATH=','StandardOutput=journal','StandardError=journal',''
 ].join('\n');
}
export function validateServiceStagingPolicy(input){
 if(!exact(input,['confirmation','policyDirectory','stagingLockRoot','existingPolicy'])||input.confirmation!=='STAGE_PINNED_PRIVATE_LAN_SERVICE_ONLY_EXCLUSIVE_OPERATOR_CUSTODY'||!pathOk(input.policyDirectory)||!pathOk(input.stagingLockRoot))fail();
 const validated=validateExistingLanForwarderPolicy(input.existingPolicy),stack=validated.stack;
 const paths=[input.policyDirectory,input.stagingLockRoot,stack.lockRoot,stack.configDirectory,stack.release.stagedDirectory,stack.storage.identity.directoryPath,stack.storage.runtimeIdentityParent,stack.tls.runtimeDirectory,runtime,'/var/lib/docker','/run/docker.sock'];
 for(const a of paths.slice(0,2))if(paths.filter(b=>overlap(a,b)).length!==1)fail();
 if(!pathOk(stack.lockRoot))fail();
 // Reconstruct exact input, not the derived policy (which has extra fields).
 const existingPolicy=Object.freeze({confirmation:input.existingPolicy.confirmation,forwarder:validated.forwarder,stack:validated.stack});
 return Object.freeze({policyDirectory:input.policyDirectory,stagingLockRoot:input.stagingLockRoot,existingPolicy});
}
async function protectedDir(path,prior,leaf=true){
 if(!pathOk(path)||await realpath(path)!==path)fail();
 for(let cur=path;;cur=dirname(cur)){
  const st=await lstat(cur);
  if(!st.isDirectory()||st.uid!==0||(st.mode&0o7022)!==0||cur===path&&leaf&&(st.mode&0o7777)!==0o700||cur===path&&prior&&!same(st,prior,dirFields))fail();
  if(cur==='/')break;
 }
 return lstat(path);
}
async function readFile(path,max){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.uid!==0||st.nlink!==1||(st.mode&0o7777)!==0o600||st.size<1||st.size>max)fail();
  const b=Buffer.alloc(st.size+1);let n=0;
  while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==st.size||!same(st,await fd.stat(),fileFields)||!same(st,await lstat(path),fileFields))fail();
  return {bytes:b.subarray(0,n),stat:st};
 }finally{await fd.close()}
}
async function writeNew(path,bytes){
 const fd=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await fd.chmod(0o600);await fd.writeFile(bytes);await fd.sync()}finally{await fd.close()}
 const r=await readFile(path,65536);
 if(!r.bytes.equals(bytes))fail();
 return r;
}
async function syncDir(path,prior){
 const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{if(!same(prior,await fd.stat(),dirFields))fail();await fd.sync()}finally{await fd.close()}
}
function rootOnly(){
 if(process.platform!=='linux'||process.geteuid?.()!==0)fail();
}
export async function stagePrivateLanService(input){
 rootOnly();
 const p=validateServiceStagingPolicy(input),dir=await protectedDir(p.policyDirectory);
 await protectedDir(p.stagingLockRoot);
 if((await readdir(p.policyDirectory)).length)fail();
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:p.stagingLockRoot},async({assertHeld})=>{
  const files=new Map();
  async function guard(){
   await assertHeld();await protectedDir(p.policyDirectory,dir);
   if(JSON.stringify((await readdir(p.policyDirectory)).sort())!==JSON.stringify([...files.keys()].sort()))fail();
   for(const [name,prior] of files){
    const current=await readFile(join(p.policyDirectory,name),65536);
    if(!current.bytes.equals(prior.bytes)||!same(current.stat,prior.stat,fileFields))fail();
   }
   await assertHeld();
  }
  await guard();
  // Actual current stack observation before storing candidate, not trust in
  // a previous receipt. Does not authorize a future systemd launch.
  const proof=await inspectLivePrivateStack(p.existingPolicy.stack);
  if(!proof.live_stack_verified||!proof.database_history_verified||!proof.private_https_readiness_verified||proof.services_mutated!==false)fail();
  await guard();
  const bytes=Buffer.from(JSON.stringify(p.existingPolicy)+'\n');
  if(bytes.length>65536)fail();
  const policySha256=sha(bytes);
  const unit=Buffer.from(renderPrivateLanServiceUnit({policyDirectory:p.policyDirectory,policySha256,adapterLockRoot:p.existingPolicy.stack.lockRoot}));
  files.set(policyName,await writeNew(join(p.policyDirectory,policyName),bytes));await syncDir(p.policyDirectory,dir);await guard();
  files.set(unitName,await writeNew(join(p.policyDirectory,unitName),unit));await syncDir(p.policyDirectory,dir);await guard();
  return Object.freeze({schema_version:1,policy_sha256:policySha256,unit_sha256:sha(unit),policy_staged:true,unit_staged:true,system_service_installed:false,system_service_started:false,automatic_restart_enabled:false,boot_start_enabled:false,production_accepted:false});
 });
}
// The service launcher receives an independently approved SHA-256 from
// the reviewed unit. Never derive approval from the candidate itself.
export async function admitPrivateLanServicePolicy(policyPath,expectedSha256){
 rootOnly();
 if(!pathOk(policyPath)||!hex(expectedSha256)||policyPath!==join(dirname(policyPath),policyName))fail();
 const parent=dirname(policyPath),dir=await protectedDir(parent),first=await readFile(policyPath,65536);
 if(sha(first.bytes)!==expectedSha256)fail();
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(first.bytes);
 rejectDuplicateJsonKeys(raw);
 const parsed=JSON.parse(raw),p=validateExistingLanForwarderPolicy(parsed);
 if(overlap(parent,p.stack.lockRoot)||overlap(parent,runtime)||overlap(parent,'/var/lib/docker'))fail();
 const unit=await readFile(join(parent,unitName),65536),expected=Buffer.from(renderPrivateLanServiceUnit({policyDirectory:parent,policySha256:expectedSha256,adapterLockRoot:p.stack.lockRoot}));
 if(!unit.bytes.equals(expected))fail();
 async function assertHeld(){
  await protectedDir(parent,dir);
  if(JSON.stringify((await readdir(parent)).sort())!==JSON.stringify([unitName,policyName].sort()))fail();
  for(const [path,prior] of [[policyPath,first],[join(parent,unitName),unit]]){
   const current=await readFile(path,65536);
   if(!current.bytes.equals(prior.bytes)||!same(current.stat,prior.stat,fileFields))fail();
  }
 }
 await assertHeld();
 return Object.freeze({policy:Object.freeze({confirmation:parsed.confirmation,forwarder:p.forwarder,stack:p.stack}),assertHeld});
}
