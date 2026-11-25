import {inspectGuidedOperationJournal} from './guided-operation-journal.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--inspect-guided-operation-history'||process.stdin.isTTY)throw Error();
 let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>16384)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await inspectGuidedOperationJournal(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Guided operation history unconfirmed. Preserve existing files and locks; obtain independent operator reconciliation. No resume or rollback authorized.\n');process.exitCode=1});
