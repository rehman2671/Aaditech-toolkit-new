import {inspectExistingComposeRecovery} from './local-compose-service-lifecycle.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--inspect-existing-compose-recovery')throw Error();
 let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>8192)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await inspectExistingComposeRecovery(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Existing container recovery observation unverified. No containers, files or locks changed; reconcile manually.\n');process.exitCode=1});
