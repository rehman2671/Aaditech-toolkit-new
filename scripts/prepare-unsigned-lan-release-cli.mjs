import {prepareUnsignedLanRelease} from './prepare-unsigned-lan-release.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--prepare-unsigned-lan-release')throw Error();
 const parts=[];let n=0;for await(const c of process.stdin){n+=c.length;if(n>8192)throw Error();parts.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await prepareUnsignedLanRelease(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Unsigned LAN release candidate unconfirmed. No signature, approval or installation authority issued. Review retained draft directories.\n');process.exitCode=1});
