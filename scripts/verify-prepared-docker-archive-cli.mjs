#!/usr/bin/env node
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {validateArchiveAdmissionPolicy,verifyPreparedDockerArchive} from './verify-prepared-docker-archive.mjs';
const flag='--verify-prepared-docker-archive',limit=32768;
export function parseArchiveAdmissionInput(bytes,argv){
 const fail=()=>{throw Error('OFFLINE_DOCKER_ARCHIVE_ADMISSION_INPUT_INVALID')};
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>limit||!Array.isArray(argv)||argv.length!==1||argv[0]!==flag)fail();
 try{
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(raw);
  const doc=JSON.parse(raw);
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||Object.hasOwn(doc,'confirmation'))fail();
  return validateArchiveAdmissionPolicy({...doc,confirmation:'VERIFY_PREPARED_DOCKER_ARCHIVE_ONLY'});
 }catch{fail()}
}
async function main(){
 if(process.argv.length!==3||process.stdin.isTTY)throw Error();
 let n=0;const chunks=[];
 for await(const chunk of process.stdin){n+=chunk.length;if(n>limit)throw Error();chunks.push(chunk)}
 const result=await verifyPreparedDockerArchive(parseArchiveAdmissionInput(Buffer.concat(chunks),process.argv.slice(2)));
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Prepared Docker archive admission refused.\n');process.exitCode=1});
