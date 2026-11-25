#!/usr/bin/env node
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {validateArchiveReadbackInput,verifyPreparedDockerArchive} from './verify-prepared-docker-archive.mjs';
export function parseArchiveReadbackInput(bytes,args){
 if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>32768||!Array.isArray(args)||args.length!==1||args[0]!=='--verify-prepared-archive')throw Error('ARCHIVE_READBACK_INPUT_INVALID');
 try{
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(source);
  const doc=JSON.parse(source);if(!doc||typeof doc!=='object'||Array.isArray(doc)||Object.hasOwn(doc,'confirmation'))throw Error();
  return validateArchiveReadbackInput({...doc,confirmation:'VERIFY_PREPARED_DOCKER_ARCHIVE_ONLY'});
 }catch{throw Error('ARCHIVE_READBACK_INPUT_INVALID')}
}
async function main(){
 if(process.stdin.isTTY)throw Error();
 const parts=[];let n=0;for await(const chunk of process.stdin){n+=chunk.length;if(n>32768)throw Error();parts.push(chunk)}
 const result=await verifyPreparedDockerArchive(parseArchiveReadbackInput(Buffer.concat(parts),process.argv.slice(2)));
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Prepared Docker archive readback refused.\n');process.exitCode=1});
