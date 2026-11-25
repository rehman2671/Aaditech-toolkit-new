import {inspectStoppedComposeCandidates} from './create-stopped-compose-candidates.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--inspect-stopped-compose-candidates')throw Error();
 const parts=[];let n=0;for await(const c of process.stdin){n+=c.length;if(n>16384)throw Error();parts.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await inspectStoppedComposeCandidates(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Stopped candidate admission unverified. No activation or resource mutation authorized. Review retained setup lock.\n');process.exitCode=1});
