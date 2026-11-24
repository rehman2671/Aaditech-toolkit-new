#!/usr/bin/env node
// Explicit interactive/local shell entry point. No remote command registration,
// network traffic, artifact persistence, signature issuance or repair.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {collectLocalResourceDiagnostic} from './local-resource-diagnostic.mjs';
import {collectLocalNetworkDiagnostic,collectLocalDiskDiagnostic} from './local-categorical-diagnostics.mjs';
const usage='Usage: node scripts/local-diagnostic-cli.mjs resource --target ABSOLUTE_PATH [--sample-ms 100..2000] --confirm-local-read-only | disk --target ABSOLUTE_PATH --confirm-local-read-only | network --interface NAME --confirm-local-read-only';
export async function runLocalDiagnosticCli(argv){
 if(!Array.isArray(argv)||!argv.every(x=>typeof x==='string'))throw Error(usage);
 const [kind,...args]=argv;
 if(!['resource','disk','network'].includes(kind))throw Error(usage);
 const opts=new Map();
 const allowed=kind==='network'?['--interface']:kind==='disk'?['--target']:['--target','--sample-ms'];
 let confirmed=false;
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(key==='--confirm-local-read-only'&&!confirmed){confirmed=true;continue}
  if(!allowed.includes(key)||opts.has(key)||i+1>=args.length||args[i+1].startsWith('--'))throw Error(usage);
  opts.set(key,args[++i]);
 }
 if(!confirmed||!opts.has(kind==='network'?'--interface':'--target'))throw Error(usage);
 let sampleMs=250;
 if(opts.has('--sample-ms')){
  const raw=opts.get('--sample-ms');
  if(!/^[1-9][0-9]{2,3}$/.test(raw)||String(Number(raw))!==raw||Number(raw)<100||Number(raw)>2000)throw Error(usage);
  sampleMs=Number(raw);
 }
 const result=kind==='resource'?await collectLocalResourceDiagnostic({confirmation:'COLLECT_LOCAL_RESOURCE_ONLY',targetDirectory:opts.get('--target'),sampleMs}):
  kind==='disk'?await collectLocalDiskDiagnostic({confirmation:'COLLECT_LOCAL_DISK_ONLY',targetDirectory:opts.get('--target')}):
  await collectLocalNetworkDiagnostic({confirmation:'COLLECT_LOCAL_NETWORK_ONLY',interfaceId:opts.get('--interface')});
 return Object.freeze({schema_version:1,artifact:JSON.parse(result.artifact.toString('utf8')),
  artifact_sha256:result.artifact_sha256,measured_fields:result.measured_fields,
  collection_scope:result.collection_scope,measurement_truth_verified:false,
  remote_execution_authorized:false,production_accepted:false});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runLocalDiagnosticCli(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result)+'\n'))
 .catch(()=>{process.stderr.write(usage+'\n');process.exitCode=1});
}
