// Explicit operator restart of the forwarder only; never restart containers.
import {startExistingPrivateLanForwarder} from './private-lan-forwarder.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--run-existing-private-lan-forwarder'||process.stdin.isTTY)throw Error();
 let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>65536)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 const gateway=await startExistingPrivateLanForwarder(JSON.parse(raw));
 let deliberate=false;const shutdown=()=>{deliberate=true;void gateway.close()};
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 process.stdout.write(JSON.stringify(gateway.receipt)+'\n');
 await gateway.closed;process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
 if(!deliberate)throw Error();
}
main().catch(()=>{process.stderr.write('Existing private LAN forwarder unconfirmed or stopped. Review independent live pins and retained locks; no automatic restart or container mutation.\n');process.exitCode=1});
