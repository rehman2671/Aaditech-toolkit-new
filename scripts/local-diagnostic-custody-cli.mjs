#!/usr/bin/env node
// Explicit local operator custody. Collection stays read-only; retaining
// bytes is a separate opt-in write to an existing private POSIX directory.
import {fileURLToPath} from 'node:url';
import {resolve,isAbsolute} from 'node:path';
import {runLocalDiagnosticCli} from './local-diagnostic-cli.mjs';
import {retainLocalDiagnosticArtifact,readRetainedLocalDiagnosticArtifact} from './local-diagnostic-artifact-store.mjs';
const usage='Usage: node scripts/local-diagnostic-custody-cli.mjs collect --directory ABSOLUTE_PATH --confirm-local-retention -- resource|disk|network [collector options] --confirm-local-read-only; or read --directory ABSOLUTE_PATH --sha256 DIGEST --confirm-local-read-only';
const fail=()=>{throw Error(usage)};
const absolute=x=>typeof x==='string'&&isAbsolute(x)&&!x.includes('\0');
export async function runLocalDiagnosticCustodyCli(argv){
 if(!Array.isArray(argv)||!argv.every(x=>typeof x==='string'))fail();
 const [action,...rest]=argv;
 if(!['collect','read'].includes(action))fail();
 const split=rest.indexOf('--');
 if(action==='collect'&&split<0||action==='read'&&split>=0)fail();
 const flags=split<0?rest:rest.slice(0,split),collector=split<0?[]:rest.slice(split+1);
 const options=new Map();let confirmed=false;
 const confirm=action==='collect'?'--confirm-local-retention':'--confirm-local-read-only';
 for(let i=0;i<flags.length;i++){
  const k=flags[i];
  if(k===confirm&&!confirmed){confirmed=true;continue}
  if(!['--directory',...(action==='read'?['--sha256']:[])].includes(k)||options.has(k)||
     i+1>=flags.length||flags[i+1].startsWith('--'))fail();
  options.set(k,flags[++i]);
 }
 const directory=options.get('--directory');
 if(!confirmed||!absolute(directory))fail();
 if(action==='read'){
  const r=await readRetainedLocalDiagnosticArtifact({confirmation:'READ_LOCAL_DIAGNOSTIC_ONLY',directory,expectedArtifactSha256:options.get('--sha256')});
  return Object.freeze({schema_version:1,artifact:JSON.parse(r.artifact.toString('utf8')),
   artifact_sha256:r.artifact_sha256,integrity_verified:true,signature_verified:false,
   measurement_truth_verified:false,attempt_accepted:false,production_accepted:false});
 }
 const collected=await runLocalDiagnosticCli(collector);
 const retained=await retainLocalDiagnosticArtifact({confirmation:'RETAIN_LOCAL_DIAGNOSTIC_ONLY',
  directory,artifact:Buffer.from(JSON.stringify(collected.artifact)),expectedArtifactSha256:collected.artifact_sha256});
 return Object.freeze({schema_version:1,...retained,measured_fields:collected.measured_fields,
  collection_scope:'LOCAL_OPERATOR_REFERENCE',remote_execution_authorized:false});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 runLocalDiagnosticCustodyCli(process.argv.slice(2)).then(r=>process.stdout.write(JSON.stringify(r)+'\n'))
 .catch(()=>{process.stderr.write('Local diagnostic custody refused. Verify confirmation, private directory, digest and duplicate state.\n');process.exitCode=1});
