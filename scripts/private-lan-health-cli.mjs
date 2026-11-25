import {probePrivateLanHealth} from './private-lan-health.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){if(process.argv.length!==3||process.argv[2]!=='--probe-private-lan-health')throw Error();let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>32768)throw Error();chunks.push(c)}const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);process.stdout.write(JSON.stringify(await probePrivateLanHealth(JSON.parse(raw)))+'\n')}
main().catch(()=>{process.stderr.write('Private LAN HTTPS health observation refused or unverified. No configuration changed.\n');process.exitCode=1});
