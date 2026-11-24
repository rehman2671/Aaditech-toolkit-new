#!/usr/bin/env node
// Read-only local operator inspection. No browser endpoint, journal writes,
// automatic replay, installation execution or recovery authorization.
import {fileURLToPath} from 'node:url';
import {resolve,isAbsolute} from 'node:path';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {inspectLocalSetupContinuity} from './local-setup-continuity.mjs';
const MAX=65536;
const fail=()=>{throw Error('LOCAL_SETUP_CONTINUITY_INPUT_INVALID')};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const abs=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&!x.includes('\0');
function decode(s,max){
 if(typeof s!=='string'||s.length<4||s.length>Math.ceil(max/3)*4||! /^[A-Za-z0-9+/]+={0,2}$/.test(s))fail();
 const bytes=Buffer.from(s,'base64');
 if(bytes.length<1||bytes.length>max||bytes.toString('base64')!==s)fail();
 return bytes;
}
export async function runLocalSetupContinuityCli(bytes,argv){
 if(!Array.isArray(argv)||argv.length!==1||argv[0]!=='--confirm-local-read-only'||
    !Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX)fail();
 let doc;try{
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  doc=JSON.parse(source);
  rejectDuplicateJsonKeys(source);
 }catch{fail()}
 if(!exact(doc,['bundle','host','anchor'])||
 !exact(doc.bundle,['manifest','root','signature','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256'])||
 !exact(doc.host,['targetDirectory','markerPaths','ports','minCpu','minMemoryBytes','minFreeBytes'])||
 !exact(doc.host.markerPaths,['database','credentials','service'])||
 !exact(doc.anchor,['directory','installationId','releaseSha256','checkpointBase64','signatureBase64',
 'signerPublicKeyPem','expectedSignerSpkiSha256','expectedCheckpointSha256'])||
 ![doc.bundle.manifest,doc.bundle.root,doc.bundle.signature,doc.host.targetDirectory,
 ...Object.values(doc.host.markerPaths),doc.anchor.directory].every(abs))fail();
 const {checkpointBase64,signatureBase64,...anchor}=doc.anchor;
 return inspectLocalSetupContinuity({confirmation:'INSPECT_LOCAL_SETUP_CONTINUITY_ONLY',bundle:doc.bundle,host:doc.host,
  anchor:{...anchor,checkpointBytes:decode(checkpointBase64,1024),signature:decode(signatureBase64,64)}});
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--confirm-local-read-only'||process.stdin.isTTY)fail();
 let size=0;const parts=[];
 for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX)fail();parts.push(chunk)}
 const result=await runLocalSetupContinuityCli(Buffer.concat(parts),process.argv.slice(2));
 process.stdout.write(JSON.stringify(result)+'\n');
 process.exitCode=result.decision==='OPERATOR_RECONCILIATION_REQUIRED'||result.fresh_host_observation.decision==='BLOCKED'?2:0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Local setup continuity refused: verify independent current release and checkpoint pins.\n');process.exitCode=1});
