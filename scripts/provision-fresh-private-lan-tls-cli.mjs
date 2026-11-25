// Local JSON metadata only. Never print or accept private key material.
import {provisionFreshPrivateLanTls} from './provision-fresh-private-lan-tls.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--provision-empty-private-lan-tls'||process.stdin.isTTY)throw Error();
 let n=0;const parts=[];
 for await(const chunk of process.stdin){n+=chunk.length;if(n>16384)throw Error();parts.push(chunk)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await provisionFreshPrivateLanTls(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Private LAN TLS provisioning unconfirmed. Do not overwrite or retry occupied material; reconcile the local setup lock and custody.\n');process.exitCode=1});
