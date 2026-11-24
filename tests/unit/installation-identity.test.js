import { describe,it,expect } from 'vitest';
import { mkdtemp,chmod,rm,writeFile,readFile,symlink,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planInstallationIdentity as plan,validateInstallationIdentity } from '../../scripts/installation-identity.mjs';
import { initializeFreshInstallationIdentity as init,readInstallationIdentity as read } from '../../scripts/installation-identity-store-posix.mjs';
const A={schema_version:1,installation_id:'6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e'};
const B={schema_version:1,installation_id:'e6e99999-1234-4bcd-8123-0123456789ab'};
const empty={database:'absent',credentials:'absent',service:'absent'};
const live={database:'present',credentials:'present',service:'present'};
describe('stack-neutral identity preflight (never authorizes mutation)',()=>{
  it('validates strict UUID v4 identity record with no secrets',()=>{
    expect(validateInstallationIdentity(A)).toEqual(A);
    for(const bad of [{...A,token:'secret'},{...A,schema_version:2},{...A,installation_id:A.installation_id+'\n'},{...A,installation_id:'00000000-0000-0000-0000-000000000000'}]) expect(()=>validateInstallationIdentity(bad)).toThrow();
  });
  it('blocks missing evidence and existing state without identity',()=>{
    expect(plan({intent:'fresh',observed:{...empty,database:'unknown'}}).reason).toBe('LOCAL_STATE_UNKNOWN');
    for(const k of Object.keys(empty)) expect(plan({intent:'fresh',observed:{...empty,[k]:'present'}}).reason).toBe('EXISTING_STATE_WITHOUT_IDENTITY');
    expect(plan({intent:'fresh',observed:empty})).toMatchObject({reason:'GENERATE_NEW_IDENTITY',mutation_authorized:false});
    expect(plan({intent:'fresh',observed:empty,localIdentity:A}).decision).toBe('BLOCKED');
  });
  it('preserves identity on reconfigure and same-install restore, rejects clone',()=>{
    expect(plan({intent:'reconfigure',observed:live,localIdentity:A})).toMatchObject({installation_id:A.installation_id,mutation_authorized:false});
    expect(plan({intent:'reconfigure',observed:{...live,credentials:'absent'},localIdentity:A}).decision).toBe('BLOCKED');
    expect(plan({intent:'restore-same',observed:live,localIdentity:A,backupIdentity:B}).reason).toBe('CROSS_INSTALLATION_RESTORE_FORBIDDEN');
    expect(plan({intent:'restore-same',observed:live,localIdentity:A,backupIdentity:A}).installation_id).toBe(A.installation_id);
    expect(plan({intent:'restore-same',observed:empty,backupIdentity:A}).reason).toBe('PREVIOUS_INSTANCE_FENCE_REQUIRED');
    expect(plan({intent:'restore-same',observed:empty,backupIdentity:A,previousInstanceFenced:true})).toMatchObject({installation_id:A.installation_id,mutation_authorized:false});
    expect(plan({intent:'clone-new',observed:empty,backupIdentity:A}).reason).toBe('CLONE_REKEY_AND_ISOLATION_NOT_IMPLEMENTED');
  });
});
describe.skipIf(process.platform==='win32')('POSIX private identity reference store',()=>{
  it('creates once with a unique persistent ID and never overwrites',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'itk-id-'));
    try {
      await chmod(dir,0o700);
      expect(await read(dir)).toBeNull();
      await expect(init(dir,live)).rejects.toThrow('EXISTING_STATE_WITHOUT_IDENTITY');
      const results=await Promise.allSettled([init(dir,empty),init(dir,empty)]);
      expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
      const stored=await read(dir);
      expect(stored).toEqual(results.find(x=>x.status==='fulfilled').value);
      const bytes=await readFile(join(dir,'installation-identity.json'));
      await expect(init(dir,empty)).rejects.toThrow();
      expect(await readFile(join(dir,'installation-identity.json'))).toEqual(bytes);
      expect((await stat(join(dir,'installation-identity.json'))).mode&0o777).toBe(0o600);
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
  it('fails closed on corrupt identity, wrong permissions and symlinks',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'itk-id-'));
    try {
      await chmod(dir,0o700);
      const file=join(dir,'installation-identity.json');
      await writeFile(file,'{bad json',{mode:0o600});
      await expect(read(dir)).rejects.toThrow();
      await expect(init(dir,empty)).rejects.toThrow();
      await rm(file);
      await writeFile(join(dir,'other'),JSON.stringify(A),{mode:0o600});
      await symlink('other',file);
      await expect(read(dir)).rejects.toThrow();
      await rm(file);
      await chmod(dir,0o755);
      await expect(init(dir,empty)).rejects.toThrow('IDENTITY_DIRECTORY_NOT_PRIVATE');
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
});
