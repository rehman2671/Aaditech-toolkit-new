import {reviewRetainedDiagnosticArtifact} from './review-retained-diagnostic-artifact.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--review-retained-diagnostic')throw Error();
 let size=0;const chunks=[];for await(const c of process.stdin){size+=c.length;if(size>16384)throw Error();chunks.push(c)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));rejectDuplicateJsonKeys(raw);
 process.stdout.write(JSON.stringify(await reviewRetainedDiagnosticArtifact(JSON.parse(raw)))+'\n');
}
main().catch(()=>{process.stderr.write('Retained diagnostic review unverified; check independent proof pins, local artifact and expiry. No attempt accepted.\n');process.exitCode=1});
