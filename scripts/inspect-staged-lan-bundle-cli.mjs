#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {inspectStagedLanBundle} from './inspect-staged-lan-bundle.mjs';
const fail=()=>{throw Error('STAGED_RELEASE_INPUT_INVALID')};
const MAX=32768;
export async function runStagedInspectionCli(bytes,argv){
 if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX||
   !Array.isArray(argv)||argv.length!==1||argv[0]!=='--confirm-local-read-only')fail();
 let doc;try{const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(source);doc=JSON.parse(source)}catch{fail()}
 const keys=['stagedDirectory','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256'];
 if(!doc||Array.isArray(doc)||typeof doc!=='object'||Object.keys(doc).length!==keys.length||
    !keys.every(k=>Object.hasOwn(doc,k)&&typeof doc[k]==='string'))fail();
 return inspectStagedLanBundle({confirmation:'INSPECT_STAGED_RELEASE_ONLY',...doc});
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--confirm-local-read-only'||process.stdin.isTTY)fail();
 let n=0;const parts=[];
 for await(const chunk of process.stdin){n+=chunk.length;if(n>MAX)fail();parts.push(chunk)}
 const r=await runStagedInspectionCli(Buffer.concat(parts),process.argv.slice(2));
 process.stdout.write(JSON.stringify(r)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Staged release inspection refused. Verify independent release pins and private staging custody.\n');process.exitCode=1});
