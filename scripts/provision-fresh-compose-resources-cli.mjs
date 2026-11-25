import {provisionFreshComposeResources} from './provision-fresh-compose-resources.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--provision-empty-compose-resources')throw Error();
 let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>16384)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await provisionFreshComposeResources(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Fresh Compose resource provisioning unconfirmed. Preserve lock and resources for manual reconciliation. No automatic retry or cleanup.\n');process.exitCode=1});
