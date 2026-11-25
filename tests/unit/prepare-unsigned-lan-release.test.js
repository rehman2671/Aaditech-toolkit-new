import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,realpath,readFile,writeFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {staged} from '../fixtures/signed-offline-oci-fixture.mjs';
import {prepareUnsignedLanRelease as prepare,validateUnsignedReleasePolicy as validate} from '../../scripts/prepare-unsigned-lan-release.mjs';
import {stageOfflineLanBundle} from '../../scripts/stage-offline-lan-bundle.mjs';
import {admitSignedFreshMigrations} from '../../scripts/initialize-fresh-mysql-schema.mjs';
const policy={confirmation:'PREPARE_UNSIGNED_LAN_RELEASE_CANDIDATE_ONLY',runtimeRoot:'/private/runtime',migrationsDirectory:'/private/sql',destinationParent:'/private/output',architecture:'amd64'};
it.each([{confirmation:'SIGN'},{architecture:'386'},{runtimeRoot:'relative'},{destinationParent:'/private'},{migrationsDirectory:'/private/runtime/sql'},{extra:true}])('rejects invalid publisher input %j',patch=>expect(()=>validate({...policy,...patch})).toThrow());
it('prepares actual release payload, signs externally with fixture key, stages and admits all migrations',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'publisher-fixture-'));
 try{
  const sql=join(root,'sql'),out=join(root,'out'),dest=join(root,'stage');for(const d of [sql,out,dest])await mkdir(d,{mode:0o700});
  for(const f of (await readdir(new URL('../../database/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')))await writeFile(join(sql,f),await readFile(new URL('../../database/migrations/'+f,import.meta.url)),{mode:0o600});
  await staged(async({input})=>{
   const p={...policy,runtimeRoot:join(input.stagedDirectory,'payload','runtime'),migrationsDirectory:sql,destinationParent:out};
   const receipt=await prepare(p);expect(receipt).toMatchObject({migrations:24,publisher_signature_verified:false,installation_authorized:false});
   const manifest=join(receipt.candidate_directory,'manifest.json'),signature=join(receipt.candidate_directory,'manifest.sig'),bytes=await readFile(manifest);
   const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({format:'pem',type:'spki'}),pin=createHash('sha256').update(key.publicKey.export({format:'der',type:'spki'})).digest('hex');
   await writeFile(signature,sign(null,bytes,key.privateKey),{mode:0o600,flag:'wx'});
   const result=await stageOfflineLanBundle({confirmation:'STAGE_VERIFIED_OFFLINE_BUNDLE_ONLY',destinationParent:dest,bundle:{root:join(receipt.candidate_directory,'payload'),manifest,signature,trustedManifestSha256:receipt.manifest_sha256,trustedPublicKeyPem:publicKey,trustedSignerSpkiSha256:pin}});
   expect((await admitSignedFreshMigrations({confirmation:'ADMIT_SIGNED_FRESH_MYSQL_MIGRATIONS_ONLY',stagedDirectory:result.staged_directory,trustedManifestSha256:receipt.manifest_sha256,trustedPublicKeyPem:publicKey,trustedSignerSpkiSha256:pin})).history).toHaveLength(24);
   await writeFile(join(sql,'025_unapproved.sql'),'SELECT 1',{mode:0o600});await expect(prepare(p)).rejects.toThrow();await rm(join(sql,'025_unapproved.sql'));
   await symlink(join(sql,'001_init_schema.sql'),join(sql,'README.md'));await rm(join(sql,'002_partitioning.sql'));await expect(prepare(p)).rejects.toThrow();
  });
 }finally{await rm(root,{recursive:true,force:true})}
},30000);
