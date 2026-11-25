import {recordRetainedDiagnosticReview} from './record-retained-diagnostic-review.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--record-local-diagnostic-review')throw Error();
 const chunks=[];let size=0;for await(const c of process.stdin){size+=c.length;if(size>16384)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await recordRetainedDiagnosticReview(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Local review record not confirmed or challenge already recorded. Reconcile private ledger; no attempt accepted.\n');process.exitCode=1});
