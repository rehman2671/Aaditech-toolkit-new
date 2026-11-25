#!/usr/bin/env node
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {prepareOfflineDockerArchive} from './prepare-offline-docker-archive.mjs';
const flag='--prepare-untagged-offline-archive',limit=32768;
export function parseArchivePreparationInput(bytes,argv){
 const fail=()=>{throw Error('OFFLINE_DOCKER_ARCHIVE_INPUT_INVALID')};
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>limit||!Array.isArray(argv)||argv.length!==1||argv[0]!==flag)fail();
 try{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(text);
  const doc=JSON.parse(text),keys=['stagedDirectory','destinationParent','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256','architecture'];
  if(!doc||Array.isArray(doc)||Object.keys(doc).length!==keys.length||!keys.every(k=>Object.hasOwn(doc,k))||
    ![doc.stagedDirectory,doc.destinationParent].every(x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x))||
    ![doc.trustedManifestSha256,doc.trustedSignerSpkiSha256].every(x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x))||
    !['amd64','arm64'].includes(doc.architecture)||typeof doc.trustedPublicKeyPem!=='string'||
    doc.trustedPublicKeyPem.length>8192||!doc.trustedPublicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n'))fail();
  return {confirmation:'PREPARE_UNTAGGED_OFFLINE_DOCKER_ARCHIVE_ONLY',...doc};
 }catch{fail()}
}
async function main(){
 if(process.argv.length!==3||process.stdin.isTTY)throw Error();
 let n=0;const chunks=[];
 for await(const chunk of process.stdin){n+=chunk.length;if(n>limit)throw Error();chunks.push(chunk)}
 const result=await prepareOfflineDockerArchive(parseArchivePreparationInput(Buffer.concat(chunks),process.argv.slice(2)));
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('Offline Docker archive preparation refused. Verify independently approved release, private output directory and capacity.\n');process.exitCode=1});
