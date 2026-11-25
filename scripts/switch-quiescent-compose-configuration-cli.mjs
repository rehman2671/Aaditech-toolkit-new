import {switchQuiescentComposeConfiguration} from './switch-runtime-configuration.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--switch-quiescent-compose-configuration')throw Error();
 let n=0;const parts=[];for await(const c of process.stdin){n+=c.length;if(n>8192)throw Error();parts.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await switchQuiescentComposeConfiguration(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Pinned Compose configuration switch unconfirmed. Keep services stopped and reconcile exact container state, file digests and retained lock. No automatic retry.\n');process.exitCode=1});
