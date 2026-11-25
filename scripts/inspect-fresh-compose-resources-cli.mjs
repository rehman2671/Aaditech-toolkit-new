import {inspectFreshComposeResources} from './fresh-compose-resource-inventory.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--inspect-fresh-compose-resources')throw Error();
 let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>4096)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await inspectFreshComposeResources(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Fresh Compose resource collision observation unverified. No installation or resource mutation authorized.\n');process.exitCode=1});
