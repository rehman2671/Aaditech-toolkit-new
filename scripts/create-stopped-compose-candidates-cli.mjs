import {createStoppedComposeCandidates} from './create-stopped-compose-candidates.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--create-stopped-compose-candidates')throw Error();
 let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>16384)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await createStoppedComposeCandidates(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Stopped Compose candidate creation unconfirmed. Preserve retained lock and resources for review; do not start or retry automatically.\n');process.exitCode=1});
