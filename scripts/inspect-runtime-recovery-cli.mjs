import {inspectRuntimeConfigurationRecovery} from './switch-runtime-configuration.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--inspect-runtime-recovery')throw Error();
 const chunks=[];let length=0;for await(const c of process.stdin){length+=c.length;if(length>8192)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await inspectRuntimeConfigurationRecovery(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Runtime recovery observation unverified; keep services stopped and reconcile manually. No files or locks changed.\n');process.exitCode=1});
