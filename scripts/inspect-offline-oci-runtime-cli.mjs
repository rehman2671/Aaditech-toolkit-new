#!/usr/bin/env node
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {inspectOfflineOciRuntime,inspectBoundOfflineRuntime} from './inspect-offline-oci-runtime.mjs';
const max=16384;
export function parseOfflineOciInput(bytes,argv){
 const fail=()=>{throw Error('OFFLINE_OCI_INPUT_INVALID')};
 if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>max||!Array.isArray(argv)||argv.length!==1||
    !['--inspect-signed-oci','--observe-bound-local-runtime'].includes(argv[0]))fail();
 try{
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(source);
  const doc=JSON.parse(source),keys=['stagedDirectory','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256','architecture'];
  if(!doc||Array.isArray(doc)||Object.keys(doc).length!==keys.length||!keys.every(k=>Object.hasOwn(doc,k))||
   typeof doc.stagedDirectory!=='string'||doc.stagedDirectory.length>4096||!isAbsolute(doc.stagedDirectory)||
   resolve(doc.stagedDirectory)!==doc.stagedDirectory||/[\x00-\x1f\x7f]/.test(doc.stagedDirectory)||
   !['amd64','arm64'].includes(doc.architecture)||
   ![doc.trustedManifestSha256,doc.trustedSignerSpkiSha256].every(x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x))||
   typeof doc.trustedPublicKeyPem!=='string'||doc.trustedPublicKeyPem.length>8192||!doc.trustedPublicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n'))fail();
  return {confirmation:'INSPECT_SIGNED_OCI_RUNTIME_ONLY',...doc};
 }catch{fail()}
}
async function main(){
 if(process.argv.length!==3||process.stdin.isTTY)throw Error();
 let n=0;const parts=[];
 for await(const chunk of process.stdin){n+=chunk.length;if(n>max)throw Error();parts.push(chunk)}
 const args=process.argv.slice(2),input=parseOfflineOciInput(Buffer.concat(parts),args);
 const result=await (args[0]==='--inspect-signed-oci'?inspectOfflineOciRuntime(input):inspectBoundOfflineRuntime(input));
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.decision==='BLOCKED')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Offline OCI inspection refused. Verify independently approved release pins and local custody.\n');process.exitCode=1});
