import {describe,it,expect} from 'vitest';
import {mkdtemp,realpath,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runLocalDiagnosticCli as run} from '../../scripts/local-diagnostic-cli.mjs';
const confirm='--confirm-local-read-only';
const exec=promisify(execFile);
describe('local diagnostic CLI',()=>{
 it('returns bounded canonical artifacts for all supported local operations',async()=>{
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-local-cli-'));
  try{
   for(const args of [['disk','--target',dir,confirm],['resource','--target',dir,'--sample-ms','100',confirm],
     ['network','--interface','lo',confirm]]){
    const r=await run(args);
    expect(r.artifact_sha256).toBe(createHash('sha256').update(JSON.stringify(r.artifact)).digest('hex'));
    expect(r).toMatchObject({collection_scope:'LOCAL_OPERATOR_REFERENCE',remote_execution_authorized:false,production_accepted:false});
    expect(JSON.stringify(r)).not.toContain(dir);
   }
   expect(await readdir(dir)).toEqual([]);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
 it('rejects unsupported operations, duplicate flags, missing confirmation and malformed sampling',async()=>{
  for(const args of [['repair',confirm],['disk','--target','/tmp'],['network','--interface','lo',confirm,confirm],
    ['disk','--target','/tmp','--target','/var',confirm],['resource','--target','/tmp','--sample-ms','100\n',confirm],
    ['network','--interface','lo','--target','/tmp',confirm]])
   await expect(run(args)).rejects.toThrow();
 });
 it('runs a real child process, emits JSON only and fails with nonzero status without echoing input',async()=>{
  const script=fileURLToPath(new URL('../../scripts/local-diagnostic-cli.mjs',import.meta.url));
  const dir=await realpath(tmpdir());
  const out=await exec(process.execPath,[script,'disk','--target',dir,confirm]);
  expect(JSON.parse(out.stdout).artifact.schema).toBe('aaditech-disk-diagnostic-v1');
  expect(out.stderr).toBe('');
  try{
   await exec(process.execPath,[script,'repair','PRIVATE-SENTINEL',confirm]);
   throw Error('expected failure');
  }catch(e){
   expect(e.code).toBe(1);expect(e.stdout).toBe('');
   expect(e.stderr).toContain('Usage:');expect(e.stderr).not.toContain('PRIVATE-SENTINEL');
  }
 });
});
