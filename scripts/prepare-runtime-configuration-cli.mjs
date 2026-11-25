import {prepareRuntimeConfiguration} from './prepare-runtime-configuration.mjs';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--prepare-runtime-configuration')throw Error();
 const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>8192)throw Error();chunks.push(chunk)}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
 const data=JSON.parse(raw);
 process.stdout.write(JSON.stringify(await prepareRuntimeConfiguration(data))+'\n');
}
main().catch(()=>{process.stderr.write('Runtime configuration candidate refused. Check local custody, active digest, lock and requested settings; no activation was attempted.\n');process.exitCode=1});
