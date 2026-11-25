#!/usr/bin/env node
// Explicit local staging write, never installation or runtime import.
import {fileURLToPath} from 'node:url';
import {resolve,isAbsolute} from 'node:path';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {stageOfflineLanBundle} from './stage-offline-lan-bundle.mjs';
const max=32768;
const fail=()=>{throw Error('OFFLINE_STAGING_INPUT_INVALID')};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export async function runOfflineStagingCli(bytes,argv){
 if(!Array.isArray(argv)||argv.length!==1||argv[0]!=='--confirm-local-staging'||
    !Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>max)fail();
 let doc;
 try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(text);doc=JSON.parse(text)}catch{fail()}
 if(!exact(doc,['bundle','destinationParent'])||
 !exact(doc.bundle,['root','manifest','signature','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256'])||
 ![doc.destinationParent,doc.bundle.root,doc.bundle.manifest,doc.bundle.signature].every(x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&!x.includes('\0')))fail();
 return stageOfflineLanBundle({confirmation:'STAGE_VERIFIED_OFFLINE_BUNDLE_ONLY',...doc});
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--confirm-local-staging'||process.stdin.isTTY)fail();
 const parts=[];let size=0;
 for await(const chunk of process.stdin){size+=chunk.length;if(size>max)fail();parts.push(chunk)}
 const r=await runOfflineStagingCli(Buffer.concat(parts),process.argv.slice(2));
 process.stdout.write(JSON.stringify(r)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Offline staging refused. Verify independently approved release pins, local private destination and available capacity.\n');process.exitCode=1});
