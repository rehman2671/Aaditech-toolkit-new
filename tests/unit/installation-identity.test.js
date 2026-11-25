import { describe,it,expect } from 'vitest';
import { mkdtemp,chmod,rm,writeFile,readFile,symlink,stat,realpath,link } from 'node:fs/promises';
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

it('requires explicit own data fields for identity and observed local state',()=>{
 expect(()=>validateInstallationIdentity(Object.create(A))).toThrow('INVALID_INSTALLATION_IDENTITY');
 let reads=0;const accessor={...A};Object.defineProperty(accessor,'installation_id',{enumerable:true,get(){reads++;return A.installation_id}});
 expect(()=>validateInstallationIdentity(accessor)).toThrow('INVALID_INSTALLATION_IDENTITY');
 expect(reads).toBe(0);
 const observed={...empty};Object.defineProperty(observed,'database',{enumerable:true,get(){reads++;return 'absent'}});
 for(const bad of [Object.create(empty),observed,{...empty,extra:true}])
  expect(plan({intent:'fresh',observed:bad}).reason).toBe('LOCAL_STATE_UNKNOWN');
 expect(reads).toBe(0);
});


describe.skipIf(process.platform!=='linux')('bounded private identity custody',()=>{
 async function fixture(run){
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-identity-custody-'));
  try{await chmod(dir,0o700);await run(dir,join(dir,'installation-identity.json'))}
  finally{await rm(dir,{recursive:true,force:true})}
 }
 const valid=JSON.stringify(A);
 const invalid=[
 ['duplicate ID',valid.replace('"installation_id":','"installation_id":"'+B.installation_id+'","installation_id":')],
 ['duplicate schema',valid.replace('"schema_version":1','"schema_version":2,"schema_version":1')],
 ['escaped duplicate',valid.replace('"schema_version":1','"schema_version":2,"schema\\u005fversion":1')],
 ['invalid UTF-8',Buffer.from([0xff,0xfe])],
 ['UTF-8 BOM',Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(valid)])],
 ['oversized',Buffer.alloc(1025,32)],['empty',''],
 ['trailing object',valid+'{}'],['unknown field',JSON.stringify({...A,secret:'test'})],
 ['wrong UUID version',JSON.stringify({...A,installation_id:A.installation_id.replace('-4ea4-','-5ea4-')})],
 ['schema string',JSON.stringify({...A,schema_version:'1'})],
 ['null','null'],['array','[]']
 ];
 it.each(invalid)('refuses %s and preserves bytes',(_name,bytes)=>fixture(async(dir,file)=>{
  await writeFile(file,bytes,{mode:0o600});
  const original=await readFile(file);
  await expect(read(dir)).rejects.toThrow();
  await expect(init(dir,empty)).rejects.toThrow();
  expect(await readFile(file)).toEqual(original);
 }));
 it.each([0o644,0o400,0o1600,0o2600,0o4600])('rejects invalid file mode %s',mode=>fixture(async(dir,file)=>{
  await writeFile(file,valid,{mode:0o600});await chmod(file,mode);
  await expect(read(dir)).rejects.toThrow();
 }));
 it.each([0o755,0o500,0o1700,0o2700,0o4700])('rejects invalid directory mode %s',mode=>fixture(async(dir)=>{
  await chmod(dir,mode);
  try{await expect(read(dir)).rejects.toThrow('IDENTITY_DIRECTORY_NOT_PRIVATE')}
  finally{await chmod(dir,0o700)}
 }));
 it('rejects hardlinked identity without overwriting it',()=>fixture(async(dir,file)=>{
  await writeFile(file,valid,{mode:0o600});const alias=join(dir,'alias');
  await link(file,alias);await expect(read(dir)).rejects.toThrow();
  await expect(init(dir,empty)).rejects.toThrow();expect(await readFile(alias,'utf8')).toBe(valid);
 }));
 it('refuses noncanonical, relative, NUL and control-character directory paths',()=>fixture(async(dir)=>{
  for(const p of [dir+'/../'+dir.split('/').at(-1),'.',dir+'\0',dir+'\n'])
   await expect(read(p)).rejects.toThrow('IDENTITY_DIRECTORY_NOT_PRIVATE');
 }));
 it('snapshots fresh observations before awaiting directory checks',()=>fixture(async(dir)=>{
  const observed={...live};const pending=init(dir,observed);
  Object.assign(observed,empty);
  await expect(pending).rejects.toThrow('EXISTING_STATE_WITHOUT_IDENTITY');
  expect(await read(dir)).toBeNull();
 }));
 it('permits valid legacy whitespace without accepting duplicate keys',()=>fixture(async(dir,file)=>{
  await writeFile(file,' \n'+JSON.stringify(A,null,2)+'\n',{mode:0o600});
  expect(await read(dir)).toEqual(A);
 }));
});
