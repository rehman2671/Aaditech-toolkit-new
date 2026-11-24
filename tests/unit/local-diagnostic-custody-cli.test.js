import {describe,it,expect} from 'vitest';
import {mkdtemp,realpath,chmod,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runLocalDiagnosticCustodyCli as run} from '../../scripts/local-diagnostic-custody-cli.mjs';
async function fixture(fn){
 const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-custody-'));
 try{await chmod(dir,0o700);await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}
}
const collect=dir=>['collect','--directory',dir,'--confirm-local-retention','--','network','--interface','lo','--confirm-local-read-only'];
const read=(dir,digest)=>['read','--directory',dir,'--sha256',digest,'--confirm-local-read-only'];
describe.skipIf(process.platform==='win32')('local operator diagnostic custody CLI',()=>{
 it('collects and explicitly retains a passive artifact then verifies the exact stored bytes',()=>fixture(async dir=>{
  const r=await run(collect(dir));
  expect(r).toMatchObject({artifact_retained:true,signature_verified:false,attempt_accepted:false,production_accepted:false,remote_execution_authorized:false});
  expect(r).not.toHaveProperty('artifact');
  expect(await readdir(dir)).toEqual([r.artifact_sha256+'.json']);
  const verified=await run(read(dir,r.artifact_sha256));
  expect(verified).toMatchObject({integrity_verified:true,signature_verified:false,measurement_truth_verified:false});
  expect(createHash('sha256').update(JSON.stringify(verified.artifact)).digest('hex')).toBe(r.artifact_sha256);
  expect(JSON.stringify(verified)).not.toContain(dir);
 }));
 it('requires distinct write and collection confirmations and refuses duplicate options',()=>fixture(async dir=>{
  for(const args of [collect(dir).filter(x=>x!=='--confirm-local-retention'),collect(dir).filter(x=>x!=='--confirm-local-read-only'),
   ['collect','--directory',dir,'--directory',dir,'--confirm-local-retention','--','network','--interface','lo','--confirm-local-read-only'],
   ['read','--directory',dir,'--sha256','a'.repeat(64),'--confirm-local-retention']])
   await expect(run(args)).rejects.toThrow();
  expect(await readdir(dir)).toEqual([]);
 }));
 it('refuses tampering and exits nonzero without echoing private input',()=>fixture(async dir=>{
  const r=await run(collect(dir));await writeFile(join(dir,r.artifact_sha256+'.json'),'{}');
  const script=fileURLToPath(new URL('../../scripts/local-diagnostic-custody-cli.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,...read(dir,r.artifact_sha256)],{encoding:'utf8',timeout:10000});
  expect(result.status).toBe(1);expect(result.stdout).toBe('');
  expect(result.stderr).not.toContain(dir);expect(result.stderr).not.toContain(r.artifact_sha256);
 }));
});
