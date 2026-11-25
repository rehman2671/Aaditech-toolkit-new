import {verifyNativeOciArchive} from './verify-native-oci-archive.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){if(process.argv.length!==3||process.argv[2]!=='--verify-native-oci-archive')throw Error();let n=0;const chunks=[];for await(const c of process.stdin){n+=c.length;if(n>16384)throw Error();chunks.push(c)}const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);process.stdout.write(JSON.stringify(await verifyNativeOciArchive(JSON.parse(raw)))+'\n')}
main().catch(()=>{process.stderr.write('Native OCI archive verification refused or unconfirmed. No image import attempted.\n');process.exitCode=1});
