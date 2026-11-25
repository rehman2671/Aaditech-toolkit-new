// Local fresh-only candidate commands. No automatic resume or publication.
import {createPrivateStackCandidates,inspectPrivateStackCandidates,initializeStoppedPrivateStack} from './create-stopped-compose-candidates.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const actions=new Map([['--create-stopped-private-stack',createPrivateStackCandidates],['--inspect-stopped-private-stack',inspectPrivateStackCandidates],['--initialize-stopped-private-stack',initializeStoppedPrivateStack]]);
async function main(){
 if(process.argv.length!==3||!actions.has(process.argv[2])||process.stdin.isTTY)throw Error();
 let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>32768)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await actions.get(process.argv[2])(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Private stack candidate operation unconfirmed. Preserve resources and retained setup lock for reconciliation. Do not retry automatically or publish ports.\n');process.exitCode=1});
