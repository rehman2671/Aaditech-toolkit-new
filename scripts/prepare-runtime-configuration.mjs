// Local operator configuration candidate only; never activates a service,
// modifies the active .env, changes TLS trust or exposes existing secret values.
import {constants} from 'node:fs';
import {open,lstat,realpath,link,unlink} from 'node:fs/promises';
import {resolve,dirname,basename,join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withLocalSetupLock} from './local-setup-lock.mjs';
const fail=()=>{throw Error('RUNTIME_CONFIGURATION_CANDIDATE_REFUSED')};
const sha=b=>createHash('sha256').update(b).digest('hex');
const own=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const dns=x=>typeof x==='string'&&x.length<=253&&x.includes('.')&&!/^[0-9.]+$/.test(x)&&x.split('.').every(y=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(y))&&!/\.(localhost|local|test|example|invalid)$/.test(x);
const dbHost=x=>typeof x==='string'&&x.length<=253&&x.split('.').every(y=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(y));
const dbName=x=>typeof x==='string'&&/^[a-zA-Z0-9_]{1,64}$/.test(x);
const port=x=>Number.isInteger(x)&&x>=1&&x<=65535;
export function patchRuntimeEnvironment(source,profile,changes){
 if(typeof source!=='string'||source.length>262144||source.includes('\0')||source.includes('\r')||!source.endsWith('\n'))fail();
 let replacements;
 if(profile==='compose'){
  if(!own(changes,['serverHost'])||!dns(changes.serverHost))fail();
  replacements={SERVER_HOST:changes.serverHost,CADDY_HOST:changes.serverHost};
 }else if(profile==='node'){
  if(!own(changes,['serverHost','port','dbHost','dbPort','dbName'])||!dns(changes.serverHost)||!port(changes.port)||!dbHost(changes.dbHost)||!port(changes.dbPort)||!dbName(changes.dbName))fail();
  replacements={SERVER_HOST:changes.serverHost,PORT:String(changes.port),DB_HOST:changes.dbHost,DB_PORT:String(changes.dbPort),DB_NAME:changes.dbName};
 }else fail();
 const seen=new Set();
 // Deliberately narrow dotenv grammar. Refuse multiline/continuations or
 // quoted target settings rather than accidentally editing secret content.
 const lines=source.split('\n').map(line=>{
  if(/^\s*(?:#.*)?$/.test(line))return line;
  const match=/^([A-Z_][A-Z0-9_]*)=([^\r\n]*)$/.exec(line);
  if(!match||seen.has(match[1]))fail();seen.add(match[1]);
  const [,,value]=match;
  if(value.endsWith('\\')||/['"]/.test(value))fail();
  if(Object.hasOwn(replacements,match[1])){
   if(!/^[a-zA-Z0-9_.-]*$/.test(value))fail();
   return match[1]+'='+replacements[match[1]];
  }
  return line;
 });
 if(Object.keys(replacements).some(k=>!seen.has(k)))fail();
 return {text:lines.join('\n'),changed_keys:Object.keys(replacements)};
}
function validPath(x){return typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x)}
function privateFile(s){return s.isFile()&&s.nlink===1&&s.uid===process.geteuid()&&(s.mode&0o7777)===0o600&&s.size>=1&&s.size<=262144}
function same(a,b){return ['dev','ino','uid','mode','size','mtimeMs','ctimeMs','nlink'].every(k=>a[k]===b[k])}
export async function prepareRuntimeConfiguration(input){
 if(!own(input,['confirmation','profile','activePath','expectedActiveSha256','lockRoot','changes'])||input.confirmation!=='PREPARE_RUNTIME_CONFIGURATION_CANDIDATE_ONLY'||process.platform!=='linux'||!validPath(input.activePath)||basename(input.activePath)!=='.env'||!validPath(input.lockRoot)||typeof input.expectedActiveSha256!=='string'||input.expectedActiveSha256.length!==64||!/^[a-f0-9]{64}$/.test(input.expectedActiveSha256)||/^0+$/.test(input.expectedActiveSha256))fail();
 const {activePath,lockRoot,profile,expectedActiveSha256}=input;
 const keys=profile==='compose'?['serverHost']:profile==='node'?['serverHost','port','dbHost','dbPort','dbName']:[];
 if(!keys.length||!own(input.changes,keys)||keys.some(k=>!['string','number'].includes(typeof input.changes[k])))fail();
 const changes=Object.freeze({...input.changes});
 const parent=dirname(activePath),candidate=join(parent,'.env.candidate');
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot},async({assertHeld})=>{
  if(parent===lockRoot)fail();
  const p=await lstat(parent);if(!p.isDirectory()||p.uid!==process.geteuid()||(p.mode&0o7777)!==0o700||await realpath(parent)!==parent)fail();
  const fd=await open(activePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let bytes,st;
  try{st=await fd.stat();if(!privateFile(st))fail();const buffer=Buffer.alloc(st.size+1);let n=0;while(n<buffer.length){const q=await fd.read(buffer,n,buffer.length-n,n);if(!q.bytesRead)break;n+=q.bytesRead}bytes=buffer.subarray(0,n);if(bytes.length!==st.size||sha(bytes)!==expectedActiveSha256||!same(st,await fd.stat())||!same(st,await lstat(activePath)))fail()}finally{await fd.close()}
  let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail()}
  if(!Buffer.from(source).equals(bytes))fail();
  const patched=patchRuntimeEnvironment(source,profile,changes),out=Buffer.from(patched.text),tmp=join(parent,'.env.candidate-'+randomUUID());
  if(out.length>262144)fail();
  let created=false;
  try{
   const f=await open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;
   try{await f.chmod(0o600);await f.writeFile(out);await f.sync()}finally{await f.close()}
   if(!same(st,await lstat(activePath)))fail();
   const now=await lstat(parent);if(now.dev!==p.dev||now.ino!==p.ino||now.uid!==p.uid||now.mode!==p.mode||await realpath(parent)!==parent)fail();
   await assertHeld();
   await link(tmp,candidate);
  }finally{if(created)await unlink(tmp)}
  const dir=await open(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{const observed=await dir.stat();if(observed.dev!==p.dev||observed.ino!==p.ino||observed.uid!==p.uid||observed.mode!==p.mode)fail();await dir.sync()}finally{await dir.close()}
  await assertHeld();
  return {profile,changed_keys:patched.changed_keys,active_sha256:expectedActiveSha256,candidate_sha256:sha(out),candidate_created:true,active_configuration_changed:false,restart_performed:false,production_accepted:false};
 });
}
