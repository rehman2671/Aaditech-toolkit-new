import {describe,it,expect} from 'vitest';
import {mkdtemp,realpath,chmod,rm,stat,writeFile,readFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {retainLocalDiagnosticArtifact as retain,readRetainedLocalDiagnosticArtifact as read} from '../../scripts/local-diagnostic-artifact-store.mjs';
import {collectLocalDiskDiagnostic} from '../../scripts/local-categorical-diagnostics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(run){
 const directory=await mkdtemp(join(await realpath(tmpdir()),'itk-local-retain-'));
 try{await chmod(directory,0o700);await run(directory)}finally{await rm(directory,{recursive:true,force:true})}
}
const doc={schema:'aaditech-resource-diagnostic-v1',cpu_percent:0,ram_percent:50,disk_percent:null};
const artifact=Buffer.from(JSON.stringify(doc));
const writeArgs=(directory,bytes=artifact)=>({confirmation:'RETAIN_LOCAL_DIAGNOSTIC_ONLY',directory,artifact:bytes,expectedArtifactSha256:sha(bytes)});
const readArgs=(directory,bytes=artifact)=>({confirmation:'READ_LOCAL_DIAGNOSTIC_ONLY',directory,expectedArtifactSha256:sha(bytes)});
describe.skipIf(process.platform==='win32')('private local artifact retention',()=>{
 it('retains actual collector bytes in a private file and reads by independent digest',()=>fixture(async directory=>{
  const result=await collectLocalDiskDiagnostic({confirmation:'COLLECT_LOCAL_DISK_ONLY',targetDirectory:directory});
  const r=await retain(writeArgs(directory,result.artifact));
  expect(r).toMatchObject({artifact_retained:true,signature_verified:false,attempt_accepted:false,production_accepted:false});
  const name=result.artifact_sha256+'.json';
  expect(await readdir(directory)).toEqual([name]);
  expect((await stat(join(directory,name))).mode&0o777).toBe(0o600);
  const restored=await read(readArgs(directory,result.artifact));
  expect(restored.artifact).toEqual(result.artifact);
  expect(restored).toMatchObject({integrity_verified:true,signature_verified:false,measurement_truth_verified:false});
 }));
 it('concurrent duplicate publication never overwrites the retained bytes',()=>fixture(async directory=>{
  const args=writeArgs(directory);
  const attempts=await Promise.allSettled([retain(args),retain(args)]);
  expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect(await readdir(directory)).toEqual([sha(artifact)+'.json']);
  expect(await readFile(join(directory,sha(artifact)+'.json'))).toEqual(artifact);
  await expect(retain(args)).rejects.toThrow('LOCAL_ARTIFACT_ALREADY_RETAINED');
 }));
 it('refuses private extra fields, fabricated active probes, and digest mismatch before publication',()=>fixture(async directory=>{
  for(const d of [{...doc,path:'private'},{...doc,cpu_percent:'0'},
   {schema:'aaditech-network-diagnostic-v1',link_state:'UP',default_route_state:'PRESENT',approved_probe_state:'REACHABLE'},
   {schema:'aaditech-disk-diagnostic-v1',free_percent:50,health_state:'HEALTHY',read_only_state:null}]){
   await expect(retain(writeArgs(directory,Buffer.from(JSON.stringify(d))))).rejects.toThrow('LOCAL_ARTIFACT_INVALID');
  }
  await expect(retain({...writeArgs(directory),expectedArtifactSha256:'a'.repeat(64)})).rejects.toThrow('LOCAL_ARTIFACT_DIGEST_MISMATCH');
  expect(await readdir(directory)).toEqual([]);
 }));
 it('rejects tampering, unsafe permissions and symlink substitution',()=>fixture(async directory=>{
  await retain(writeArgs(directory));
  const path=join(directory,sha(artifact)+'.json');
  await chmod(path,0o644);await expect(read(readArgs(directory))).rejects.toThrow('LOCAL_ARTIFACT_FILE_INVALID');
  await chmod(path,0o600);await writeFile(path,JSON.stringify({...doc,ram_percent:51}));
  await expect(read(readArgs(directory))).rejects.toThrow('LOCAL_ARTIFACT_DIGEST_MISMATCH');
  await rm(path);await symlink('/dev/null',path);
  await expect(read(readArgs(directory))).rejects.toThrow();
  await chmod(directory,0o755);await expect(retain(writeArgs(directory))).rejects.toThrow('PRIVATE_ARTIFACT_DIRECTORY_REQUIRED');
 }));
});
