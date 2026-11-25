import {stagePrivateLanService} from './private-lan-service-policy.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--stage-private-lan-service'||process.stdin.isTTY)throw Error();
 let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>65536)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await stagePrivateLanService(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Service staging unconfirmed. Preserve candidate files and retained lock; do not overwrite or enable automatically.\n');process.exitCode=1});
