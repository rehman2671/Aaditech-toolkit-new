// Explicit existing stack lifecycle only. Never create/reinitialize or recover
// uncertain state; failures preserve the cooperative setup lock.
import {stopExistingPrivateStack,startExitedPrivateStack} from './create-stopped-compose-candidates.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const actions=new Map([['--stop-pinned-private-stack',stopExistingPrivateStack],['--start-pinned-exited-private-stack',startExitedPrivateStack]]);
async function main(){
 if(process.argv.length!==3||!actions.has(process.argv[2])||process.stdin.isTTY)throw Error();
 let size=0;const chunks=[];for await(const c of process.stdin){size+=c.length;if(size>65536)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await actions.get(process.argv[2])(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Existing private stack lifecycle unconfirmed. Preserve resources and locks; do not retry, initialize or delete automatically.\n');process.exitCode=1});
