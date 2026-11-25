import {inspectGuidedResourceRecovery} from './inspect-guided-resource-recovery.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--inspect-guided-resource-recovery'||process.stdin.isTTY)throw Error();
 let size=0;const chunks=[];for await(const chunk of process.stdin){size+=chunk.length;if(size>16384)throw Error();chunks.push(chunk)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await inspectGuidedResourceRecovery(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Guided resource recovery observation unconfirmed. Preserve resources and locks; no mutation or resume authorized.\n');process.exitCode=1});
