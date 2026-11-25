#!/usr/bin/env node
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {validateDockerObservationPolicy,inspectLocalDockerRuntime} from './local-docker-runtime-preflight.mjs';
const limit=8192;
export function parseLocalDockerObservationInput(bytes,argv){
 if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>limit||!Array.isArray(argv)||
   argv.length!==1||argv[0]!=='--confirm-local-docker-read-only')throw Error('DOCKER_OBSERVATION_INPUT_INVALID');
 try{
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  rejectDuplicateJsonKeys(source);
  const doc=JSON.parse(source);
  if(!doc||Array.isArray(doc)||Object.keys(doc).length!==2||
    !Object.hasOwn(doc,'architecture')||!Object.hasOwn(doc,'imageIds'))throw Error();
  const policy={confirmation:'OBSERVE_LOCAL_DOCKER_ONLY',...doc};
  validateDockerObservationPolicy(policy);return policy;
 }catch{throw Error('DOCKER_OBSERVATION_INPUT_INVALID')}
}
async function main(){
 if(process.argv.length!==3||process.stdin.isTTY)throw Error();
 let n=0;const chunks=[];
 for await(const chunk of process.stdin){n+=chunk.length;if(n>limit)throw Error();chunks.push(chunk)}
 const result=await inspectLocalDockerRuntime(parseLocalDockerObservationInput(Buffer.concat(chunks),process.argv.slice(2)));
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.decision==='BLOCKED')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Local Docker observation refused. Verify local socket custody, independent image ID pins and operator policy.\n');process.exitCode=1});
