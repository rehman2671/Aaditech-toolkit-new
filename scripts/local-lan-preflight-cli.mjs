#!/usr/bin/env node
// Operator-only signed-bundle and host preflight CLI. JSON via stdin avoids
// long argument lists; configuration contains public pins, not secrets.
import {fileURLToPath} from 'node:url';
import {resolve,isAbsolute} from 'node:path';
import {inspectLocalLanReadiness} from './lan-combined-preflight.mjs';
const MAX=32768;
const fail=()=>{throw Error('LOCAL_PREFLIGHT_INPUT_INVALID')};
const keys=(value,list)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===list.length&&list.every(k=>Object.hasOwn(value,k));
const abs=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&!x.includes('\0');
export async function runLocalLanPreflightCli(bytes,argv){
 if(!Array.isArray(argv)||argv.length!==1||argv[0]!=='--confirm-local-read-only'||
    !Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX)fail();
 let doc;try{doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{fail()}
 if(!keys(doc,['bundle','host'])||!keys(doc.bundle,['manifest','root','signature','trustedManifestSha256',
    'trustedPublicKeyPem','trustedSignerSpkiSha256'])||!keys(doc.host,['targetDirectory','markerPaths','ports','minCpu','minMemoryBytes','minFreeBytes'])||
    !keys(doc.host.markerPaths,['database','credentials','service'])||
    ![doc.bundle.manifest,doc.bundle.root,doc.bundle.signature,doc.host.targetDirectory,...Object.values(doc.host.markerPaths)].every(abs))fail();
 return inspectLocalLanReadiness({confirmation:'INSPECT_LOCAL_LAN_ONLY',bundle:doc.bundle,host:doc.host});
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--confirm-local-read-only'||process.stdin.isTTY)fail();
 const parts=[];let total=0;
 for await(const chunk of process.stdin){total+=chunk.length;if(total>MAX)fail();parts.push(chunk)}
 const result=await runLocalLanPreflightCli(Buffer.concat(parts),process.argv.slice(2));
 process.stdout.write(JSON.stringify(result)+'\n');
 // A valid report is not installation success. Blockers return distinct status.
 process.exitCode=result.decision==='BLOCKED'?2:0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Local LAN preflight refused: verify local JSON input, public pins and bundle integrity.\n');process.exitCode=1});
