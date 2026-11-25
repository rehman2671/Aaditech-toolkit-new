import {initializeFreshComposeEnvironment} from './initialize-fresh-compose-environment.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--initialize-empty-compose-environment')throw Error();
 let n=0;const chunks=[];for await(const chunk of process.stdin){n+=chunk.length;if(n>16384)throw Error();chunks.push(chunk)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await initializeFreshComposeEnvironment(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Fresh Compose environment unconfirmed. Never overwrite credentials or retry an uncertain setup lock. No installation authorized.\n');process.exitCode=1});
