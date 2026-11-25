// Local fresh-only orchestration; never accept browser evidence or resume.
import {initializeGuidedPrivateStack} from './initialize-guided-private-stack.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--initialize-guided-private-stack'||process.stdin.isTTY)throw Error();
 let n=0;const parts=[];for await(const c of process.stdin){n+=c.length;if(n>32768)throw Error();parts.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await initializeGuidedPrivateStack(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Guided private stack unconfirmed. Preserve operation and adapter locks, journal and resources for operator reconciliation. Do not retry or remove data automatically.\n');process.exitCode=1});
