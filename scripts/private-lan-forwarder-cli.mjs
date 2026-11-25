// Foreground local service only. Never install a system service or firewall rule.
import {startPrivateLanForwarder} from './private-lan-forwarder.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--run-pinned-private-lan-forwarder'||process.stdin.isTTY)throw Error();
 let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>32768)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 const gateway=await startPrivateLanForwarder(JSON.parse(raw));
 let deliberate=false;const shutdown=()=>{deliberate=true;void gateway.close()};
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 process.stdout.write(JSON.stringify(gateway.receipt)+'\n');
 await gateway.closed;process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
 if(!deliberate)throw Error();
}
main().catch(()=>{process.stderr.write('Private LAN forwarder unconfirmed or stopped. Review operator custody, network and certificate pins; no automatic restart.\n');process.exitCode=1});
