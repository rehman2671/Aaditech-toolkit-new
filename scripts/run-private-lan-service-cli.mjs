// Fixed systemd foreground entrypoint. No automatic service or Docker start.
import {admitPrivateLanServicePolicy} from './private-lan-service-policy.mjs';
import {startExistingPrivateLanForwarder} from './private-lan-forwarder.mjs';
async function main(){
 if(process.argv.length!==5||process.argv[2]!=='--run-pinned-service')throw Error();
 const admitted=await admitPrivateLanServicePolicy(process.argv[3],process.argv[4]);
 const gateway=await startExistingPrivateLanForwarder(admitted.policy,admitted.assertHeld);
 let deliberate=false;const shutdown=()=>{deliberate=true;void gateway.close()};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
 process.stdout.write(JSON.stringify(gateway.receipt)+'\n');
 await gateway.closed;process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);
 if(!deliberate)throw Error();
}
main().catch(()=>{process.stderr.write('Pinned service unconfirmed or stopped. Reconcile protected policy and independently held running stack pins; no automatic restart.\n');process.exitCode=1});
