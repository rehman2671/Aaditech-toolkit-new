#!/usr/bin/env node
// Local paths and public CA only on stdin; no private key bytes in JSON.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {inspectPrivateLanTlsMaterial} from './private-lan-tls-material.mjs';
const fail=()=>{throw Error('TLS_MATERIAL_INPUT_INVALID')};
const MAX=32768;
export async function runPrivateTlsMaterialCli(bytes,argv){
 if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX||
 !Array.isArray(argv)||argv.length!==1||argv[0]!=='--confirm-local-read-only')fail();
 let doc;try{const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(source);doc=JSON.parse(source)}catch{fail()}
 const keys=['address','hostname','port','rootPem','trustedRootSha256','leafCertificatePath','privateKeyPath'];
 if(!doc||typeof doc!=='object'||Array.isArray(doc)||Object.keys(doc).length!==keys.length||
    !keys.every(k=>Object.hasOwn(doc,k)&& (k==='port'?Number.isInteger(doc[k]):typeof doc[k]==='string')))fail();
 return inspectPrivateLanTlsMaterial({confirmation:'INSPECT_PRIVATE_TLS_MATERIAL_ONLY',...doc});
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--confirm-local-read-only'||process.stdin.isTTY)fail();
 let n=0;const parts=[];
 for await(const chunk of process.stdin){n+=chunk.length;if(n>MAX)fail();parts.push(chunk)}
 process.stdout.write(JSON.stringify(await runPrivateTlsMaterialCli(Buffer.concat(parts),process.argv.slice(2)))+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Private TLS material inspection refused. Verify local custody, root pin, exact SAN, validity and key pairing.\n');process.exitCode=1});
