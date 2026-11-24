import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectLocalResourceDiagnostic as collect} from '../../scripts/local-resource-diagnostic.mjs';
const confirmation='COLLECT_LOCAL_RESOURCE_ONLY';
describe('local resource collector (no remote execution)',()=>{
 it('reads real OS counters into the bounded canonical artifact without writing files',async()=>{
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-resource-'));
  try{
   const result=await collect({confirmation,targetDirectory:dir,sampleMs:100});
   const doc=JSON.parse(result.artifact.toString('utf8'));
   expect(Object.keys(doc)).toEqual(['schema','cpu_percent','ram_percent','disk_percent']);
   expect(doc.schema).toBe('aaditech-resource-diagnostic-v1');
   const fields=[doc.cpu_percent,doc.ram_percent,doc.disk_percent];
   expect(fields.every(v=>v===null||(typeof v==='number'&&v>=0&&v<=100))).toBe(true);
   expect(result.measured_fields).toBe(fields.filter(v=>v!==null).length);
   expect(result.artifact_sha256).toBe(createHash('sha256').update(result.artifact).digest('hex'));
   expect(result).toMatchObject({collection_scope:'LOCAL_OPERATOR_REFERENCE',measurement_truth_verified:false,
    remote_execution_authorized:false,production_accepted:false});
   expect(result.artifact.toString()).not.toContain(dir);
   expect(await readdir(dir)).toEqual([]);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
 it('requires explicit local confirmation, absolute path and bounded sampling window',async()=>{
  const targetDirectory=await realpath(tmpdir());
  for(const input of [{targetDirectory},{confirmation,targetDirectory:'relative'},
    {confirmation,targetDirectory,sampleMs:99},{confirmation,targetDirectory,sampleMs:2001},
    {confirmation,targetDirectory,sampleMs:'100'}])
   await expect(collect(input)).rejects.toThrow('EXPLICIT_LOCAL_RESOURCE_POLICY_REQUIRED');
 });
 it('reports missing filesystem observation as null rather than fabricated zero',async()=>{
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-resource-'));
  try{
   const result=await collect({confirmation,targetDirectory:join(dir,'missing'),sampleMs:100});
   expect(JSON.parse(result.artifact).disk_percent).toBeNull();
  }finally{await rm(dir,{recursive:true,force:true})}
 });
});
