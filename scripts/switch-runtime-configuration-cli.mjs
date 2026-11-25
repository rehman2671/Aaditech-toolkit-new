import {switchRuntimeConfiguration} from './switch-runtime-configuration.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--switch-runtime-configuration')throw Error();
 const chunks=[];let length=0;for await(const c of process.stdin){length+=c.length;if(length>8192)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await switchRuntimeConfiguration(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Configuration switch not confirmed. Keep services stopped, reconcile active/candidate/backup digests and setup lock; do not assume rollback or restart occurred.\n');process.exitCode=1});
