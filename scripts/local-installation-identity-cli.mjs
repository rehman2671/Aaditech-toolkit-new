#!/usr/bin/env node
// Local identity metadata only. Initialization requires a dedicated lock root.
// Never accept an externally selected UUID for new initialization.
import {resolve,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {initializeLocalInstallationIdentity,inspectLocalInstallationIdentity} from './installation-identity-store-posix.mjs';
import {withLocalSetupLock} from './local-setup-lock.mjs';
const fail=()=>{throw Error('LOCAL_IDENTITY_INPUT_INVALID')};
const path=v=>typeof v==='string'&&v.length<=4096&&isAbsolute(v)&&resolve(v)===v&&!v.includes('\0');
const inside=(a,b)=>{const r=relative(a,b);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep))};
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export async function runLocalIdentityCli(bytes,argv){
 if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>16384||!Array.isArray(argv)||argv.length!==1||
   !['--initialize-empty-store','--inspect-pinned-store'].includes(argv[0]))fail();
 let doc;
 try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(raw);doc=JSON.parse(raw)}catch{fail()}
 if(argv[0]==='--initialize-empty-store'){
  if(!exact(doc,['directoryPath','lockRoot','observed'])||!path(doc.directoryPath)||!path(doc.lockRoot)||
   inside(doc.directoryPath,doc.lockRoot)||inside(doc.lockRoot,doc.directoryPath))fail();
  return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:doc.lockRoot},
   ()=>initializeLocalInstallationIdentity({confirmation:'INITIALIZE_EMPTY_IDENTITY_STORE_ONLY',directoryPath:doc.directoryPath,observed:doc.observed}));
 }
 if(!exact(doc,['directoryPath','expectedInstallationId','expectedIdentitySha256'])||!path(doc.directoryPath))fail();
 return inspectLocalInstallationIdentity({confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',...doc});
}
async function main(){
 if(process.argv.length!==3||process.stdin.isTTY)fail();
 let length=0;const chunks=[];
 for await(const chunk of process.stdin){length+=chunk.length;if(length>16384)fail();chunks.push(chunk)}
 const result=await runLocalIdentityCli(Buffer.concat(chunks),process.argv.slice(2));
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Local identity operation refused. Preserve existing identity and any interrupted lock for operator reconciliation.\n');process.exitCode=1});
