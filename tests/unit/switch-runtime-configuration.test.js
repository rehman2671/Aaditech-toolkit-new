import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {switchRuntimeConfiguration} from '../../scripts/switch-runtime-configuration.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const old='SERVER_HOST=old.example.com\nCADDY_HOST=old.example.com\nDB_PASSWORD=private-value\n';
const next=old.replaceAll('old.example.com','new.example.com');
async function fixture(fn,content=next){
 const root=await mkdtemp(join(await realpath(tmpdir()),'switch-env-'));
 try{
  const activePath=join(root,'.env'),lockRoot=join(root,'lock');await mkdir(lockRoot,{mode:0o700});await writeFile(activePath,old,{mode:0o600});await writeFile(join(root,'.env.candidate'),content,{mode:0o600});
  const input={confirmation:'SWITCH_CONFIGURATION_FILE_ONLY_SERVICES_QUIESCED',operation:'activate',profile:'compose',activePath,lockRoot,originalSha256:sha(old),candidateSha256:sha(content),changes:{serverHost:'new.example.com'}};
  await fn({input,root,activePath});
 }finally{await rm(root,{recursive:true,force:true})}
}
describe.skipIf(process.platform!=='linux')('local atomic configuration file switch',()=>{
 it('activates with durable private recovery copy and rolls back exact original bytes',async()=>fixture(async({input,root,activePath})=>{
  const r=await switchRuntimeConfiguration(input);expect(r).toMatchObject({active_sha256:sha(next),configuration_file_changed:true,service_restart_performed:false,production_accepted:false});expect(JSON.stringify(r)).not.toContain('private-value');
  const backup=join(root,'.env.previous-'+sha(old));expect(await readFile(backup,'utf8')).toBe(old);expect((await stat(backup)).mode&0o777).toBe(0o600);expect(await readFile(activePath,'utf8')).toBe(next);
  const restored=await switchRuntimeConfiguration({...input,operation:'rollback',confirmation:'RESTORE_CONFIGURATION_FILE_ONLY_SERVICES_QUIESCED'});expect(restored.active_sha256).toBe(sha(old));expect(await readFile(activePath,'utf8')).toBe(old);
 }));
 it('rejects secret mutation even with correct candidate hash',async()=>fixture(async({input,activePath})=>{await expect(switchRuntimeConfiguration(input)).rejects.toThrow();expect(await readFile(activePath,'utf8')).toBe(old)},next.replace('private-value','changed')));
 it('rejects stale pin',async()=>fixture(async({input,activePath})=>{await expect(switchRuntimeConfiguration({...input,originalSha256:'f'.repeat(64)})).rejects.toThrow();expect(await readFile(activePath,'utf8')).toBe(old)}));
 it('rejects existing recovery copy without overwriting it',async()=>fixture(async({input,root,activePath})=>{const p=join(root,'.env.previous-'+sha(old));await writeFile(p,'existing',{mode:0o600});await expect(switchRuntimeConfiguration(input)).rejects.toThrow();expect(await readFile(p,'utf8')).toBe('existing');expect(await readFile(activePath,'utf8')).toBe(old)}));
 it('rejects rollback without matching active candidate',async()=>fixture(async({input,activePath})=>{await expect(switchRuntimeConfiguration({...input,operation:'rollback',confirmation:'RESTORE_CONFIGURATION_FILE_ONLY_SERVICES_QUIESCED'})).rejects.toThrow();expect(await readFile(activePath,'utf8')).toBe(old)}));
});
