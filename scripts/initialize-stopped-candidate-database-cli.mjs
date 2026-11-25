// Local explicit operator only; no remote API or automatic retry.
import {initializeStoppedCandidateDatabase} from './create-stopped-compose-candidates.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--initialize-pinned-fresh-database')throw Error();
 const parts=[];let n=0;for await(const c of process.stdin){n+=c.length;if(n>16384)throw Error();parts.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await initializeStoppedCandidateDatabase(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Fresh database initialization unconfirmed. The database may have started or changed. Do not retry, remove data, or start API/ingress; reconcile the retained setup lock and resources.\n');process.exitCode=1});
