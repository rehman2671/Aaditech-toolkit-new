import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectRuntimeConfigurationRecovery} from '../../scripts/switch-runtime-configuration.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const old='SERVER_HOST=old.example.com\nCADDY_HOST=old.example.com\nDB_PASSWORD=secret\n',next=old.replaceAll('old.example.com','new.example.com');
it.skipIf(process.platform!=='linux')('observes prepared, active, restored and interrupted file states without changing anything',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'runtime-recovery-'));
 try{
  const activePath=join(root,'.env'),candidate=join(root,'.env.candidate'),backup=join(root,'.env.previous-'+sha(old)),lockRoot=join(root,'lock');
  await mkdir(lockRoot,{mode:0o700});await writeFile(activePath,old,{mode:0o600});await writeFile(candidate,next,{mode:0o600});
  const input={confirmation:'INSPECT_RUNTIME_CONFIGURATION_RECOVERY_ONLY',profile:'compose',activePath,lockRoot,originalSha256:sha(old),candidateSha256:sha(next),changes:{serverHost:'new.example.com'}};
  expect((await inspectRuntimeConfigurationRecovery(input)).state).toBe('PREPARED_NOT_SWITCHED');
  await writeFile(backup,old,{mode:0o600});await writeFile(activePath,next,{mode:0o600});
  expect((await inspectRuntimeConfigurationRecovery(input)).state).toBe('CANDIDATE_ACTIVE_BACKUP_MATCHED');
  await writeFile(activePath,old,{mode:0o600});expect((await inspectRuntimeConfigurationRecovery(input)).state).toBe('ORIGINAL_ACTIVE_BACKUP_MATCHED');
  await mkdir(join(lockRoot,'setup.lock'),{mode:0o700});const r=await inspectRuntimeConfigurationRecovery(input);expect(r).toMatchObject({state:'MANUAL_RECONCILIATION_REQUIRED',lock_entries_present:true,files_changed:false,lock_removed:false,service_restart_authorized:false});
  expect(JSON.stringify(r)).not.toContain('secret');expect(await readFile(activePath,'utf8')).toBe(old);
  await writeFile(candidate,'bad',{mode:0o600});expect((await inspectRuntimeConfigurationRecovery(input)).candidate_state).toBe('UNVERIFIED');
 }finally{await rm(root,{recursive:true,force:true})}
});
