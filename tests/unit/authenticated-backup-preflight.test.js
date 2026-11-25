import {describe,it,expect} from 'vitest';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,symlink,link,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonicalBackupManifest,verifyAuthenticatedBackup,preflightAuthenticatedRestore}
  from '../../scripts/authenticated-backup-preflight.mjs';

const A='6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e';
const B='e6e99999-1234-4bcd-8123-0123456789ab';
const empty={database:'absent',credentials:'absent',service:'absent'};
const live={database:'present',credentials:'present',service:'present'};
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(run) {
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-backup-'));
  try {
    const key=generateKeyPairSync('ed25519'); // synthetic test key only
    const payload=Buffer.from('opaque test payload; not actually encrypted');
    const manifest={schema_version:1,installation_id:A,backup_id:B,
      created_at:'2026-11-24T00:00:00.000Z',format:'encrypted-backup-container',
      payload_size:payload.length,payload_sha256:sha(payload)};
    const backup={manifestPath:join(dir,'manifest.json'),signaturePath:join(dir,'manifest.sig'),
      payloadPath:join(dir,'backup.bin'),trustedPublicKeyPem:key.publicKey.export({type:'spki',format:'pem'}),
      trustedSignerSpkiSha256:sha(key.publicKey.export({type:'spki',format:'der'})),
      expectedInstallationId:A};
    await writeFile(backup.payloadPath,payload);
    const signed=async bytes=>{
      await writeFile(backup.manifestPath,bytes);
      await writeFile(backup.signaturePath,sign(null,bytes,key.privateKey));
    };
    await signed(canonicalBackupManifest(manifest));
    await run({dir,backup,manifest,signed,payload});
  } finally { await rm(dir,{recursive:true,force:true}); }
}
describe('offline authenticated backup identity preflight',()=>{
  it('verifies independently pinned Ed25519 provenance and exact payload without claiming encryption or restore authorization',()=>fixture(async ({backup})=>{
    const result=await verifyAuthenticatedBackup(backup);
    expect(result).toMatchObject({authenticated_manifest:true,payload_integrity_verified:true,
      encryption_verified:false,freshness_or_fencing_verified:false,mutation_authorized:false,
      identity:{schema_version:1,installation_id:A},backup_id:B});
    const same=await preflightAuthenticatedRestore({backup,observed:live,localIdentity:{schema_version:1,installation_id:A},intent:'restore-same'});
    expect(same.decision).toMatchObject({reason:'PRESERVE_BACKUP_IDENTITY',installation_id:A,mutation_authorized:false});
    expect(same.mutation_authorized).toBe(false);
  }));
  it('rejects wrong key pin, wrong installation and altered signed bytes',()=>fixture(async ({backup,manifest})=>{
    await expect(verifyAuthenticatedBackup({...backup,trustedSignerSpkiSha256:'0'.repeat(64)})).rejects.toThrow('BACKUP_SIGNER_PIN_MISMATCH');
    await expect(verifyAuthenticatedBackup({...backup,expectedInstallationId:B})).rejects.toThrow('BACKUP_INSTALLATION_MISMATCH');
    await writeFile(backup.manifestPath,canonicalBackupManifest({...manifest,backup_id:A}));
    await expect(verifyAuthenticatedBackup(backup)).rejects.toThrow('BACKUP_SIGNATURE_INVALID');
  }));
  it('rejects even valid signatures over ambiguous or unsupported manifests',()=>fixture(async ({backup,manifest,signed})=>{
    const canonical=canonicalBackupManifest(manifest).toString();
    await signed(Buffer.from(canonical.replace('"schema_version":1','"schema_version":1,"schema_version":1')));
    await expect(verifyAuthenticatedBackup(backup)).rejects.toThrow('BACKUP_MANIFEST_NOT_CANONICAL');
    await signed(Buffer.from(JSON.stringify({...manifest,extra:'ignored'})+'\n'));
    await expect(verifyAuthenticatedBackup(backup)).rejects.toThrow('INVALID_BACKUP_MANIFEST');
  }));
  it('rejects same-length payload tampering and oversized payload',()=>fixture(async ({backup,payload})=>{
    const corrupt=Buffer.from(payload);corrupt[0]^=1;
    await writeFile(backup.payloadPath,corrupt);
    await expect(verifyAuthenticatedBackup(backup)).rejects.toThrow('BACKUP_PAYLOAD_DIGEST_MISMATCH');
    await writeFile(backup.payloadPath,Buffer.concat([payload,Buffer.from('x')]));
    await expect(verifyAuthenticatedBackup(backup)).rejects.toThrow('INVALID_BACKUP_FILE');
  }));
  it('does not permit cross-office restore, unfenced replacement or clone despite a valid signature',()=>fixture(async ({backup})=>{
    for (const input of [
      {observed:live,localIdentity:{schema_version:1,installation_id:B},intent:'restore-same',reason:'CROSS_INSTALLATION_RESTORE_FORBIDDEN'},
      {observed:empty,intent:'restore-same',reason:'PREVIOUS_INSTANCE_FENCE_REQUIRED'},
      {observed:empty,intent:'clone-new',reason:'CLONE_REKEY_AND_ISOLATION_NOT_IMPLEMENTED'}
    ]) {
      const result=await preflightAuthenticatedRestore({backup,...input});
      expect(result.decision).toMatchObject({decision:'BLOCKED',reason:input.reason,mutation_authorized:false});
    }
  }));
  it.skipIf(process.platform==='win32')('rejects file aliases rather than resolving them silently',()=>fixture(async ({dir,backup})=>{
    const alias=join(dir,'alias.bin');
    await symlink(backup.payloadPath,alias);
    await expect(verifyAuthenticatedBackup({...backup,payloadPath:alias})).rejects.toThrow('BACKUP_PATH_ALIAS');
    await link(backup.payloadPath,join(dir,'hard.bin'));
    await expect(verifyAuthenticatedBackup(backup)).rejects.toThrow('INVALID_BACKUP_FILE');
  }));
});


describe('strict backup provenance boundaries',()=>{
 const record={schema_version:1,installation_id:A,backup_id:B,created_at:'2026-11-24T00:00:00.000Z',
  format:'encrypted-backup-container',payload_size:1,payload_sha256:'a'.repeat(64)};
 const bad=[
 ['null',()=>null],['array',()=>[]],['inherited',r=>Object.create(r)],
 ['extra',r=>({...r,extra:true})],['symbol',r=>({...r,[Symbol('extra')]:1})],
 ['hidden',r=>{Object.defineProperty(r,'backup_id',{enumerable:false});return r}],
 ['missing',r=>{delete r.backup_id;return r}],
 ['schema string',r=>({...r,schema_version:'1'})],['wrong format',r=>({...r,format:'plaintext'})],
 ['bad calendar',r=>({...r,created_at:'2026-02-30T00:00:00.000Z'})],
 ['non-UTC',r=>({...r,created_at:'2026-11-24T00:00:00.000+00:00'})],
 ['leap second',r=>({...r,created_at:'2026-11-24T00:00:60.000Z'})],
 ['zero size',r=>({...r,payload_size:0})],['negative size',r=>({...r,payload_size:-1})],
 ['fractional size',r=>({...r,payload_size:1.5})],['string size',r=>({...r,payload_size:'1'})],
 ['oversize',r=>({...r,payload_size:1024**4+1})],['NaN size',r=>({...r,payload_size:NaN})],
 ['uppercase digest',r=>({...r,payload_sha256:'A'.repeat(64)})],
 ['short digest',r=>({...r,payload_sha256:'a'.repeat(63)})],
 ['nonhex digest',r=>({...r,payload_sha256:'g'.repeat(64)})],
 ['newline digest',r=>({...r,payload_sha256:'a'.repeat(63)+'\n'})],
 ['bad install UUID',r=>({...r,installation_id:'invalid'})],
 ['bad backup UUID',r=>({...r,backup_id:B.toUpperCase()})]
 ];
 it.each(bad)('rejects manifest %s',(_name,change)=>expect(()=>canonicalBackupManifest(change({...record}))).toThrow());
 it('does not invoke manifest getters',()=>{
  let reads=0;const r={...record};Object.defineProperty(r,'payload_size',{enumerable:true,get(){reads++;return 1}});
  expect(()=>canonicalBackupManifest(r)).toThrow('INVALID_BACKUP_MANIFEST');expect(reads).toBe(0);
 });
 const paths=[
 ['relative manifest',b=>({...b,manifestPath:'manifest.json'})],
 ['relative payload',b=>({...b,payloadPath:'backup.bin'})],
 ['relative signature',b=>({...b,signaturePath:'manifest.sig'})],
 ['aliased lexical path',b=>({...b,payloadPath:b.payloadPath.replace(/[^/\\]+$/,'./backup.bin')})],
 ['duplicate signature',b=>({...b,signaturePath:b.manifestPath})],
 ['duplicate payload',b=>({...b,payloadPath:b.manifestPath})],
 ['NUL',b=>({...b,payloadPath:b.payloadPath+'\0'})],
 ['line break',b=>({...b,payloadPath:b.payloadPath+'\n'})],
 ['too long',b=>({...b,payloadPath:b.payloadPath+'x'.repeat(4096)})],
 ['number path',b=>({...b,payloadPath:1})]
 ];
 it.each(paths)('rejects %s before file reads',(_name,change)=>fixture(async({backup})=>{
  await expect(verifyAuthenticatedBackup(change(backup))).rejects.toThrow('BACKUP_PATH_INVALID');
 }));
 it('rejects inherited, unknown and getter-backed backup records',()=>fixture(async({backup})=>{
  let reads=0;const access={...backup};Object.defineProperty(access,'payloadPath',{enumerable:true,get(){reads++;return backup.payloadPath}});
  for(const b of [Object.create(backup),{...backup,extra:true},access])
   await expect(verifyAuthenticatedBackup(b)).rejects.toThrow('EXPLICIT_BACKUP_INPUT_REQUIRED');
  expect(reads).toBe(0);
 }));
 it.each(['concatenated','extra newline','invalid base64','private key header'])('rejects %s PEM',kind=>fixture(async({backup})=>{
  const p=backup.trustedPublicKeyPem;
  const pem=kind==='concatenated'?p+p:kind==='extra newline'?p+'\n\n':
   kind==='invalid base64'?'-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n':p.replaceAll('PUBLIC KEY','PRIVATE KEY');
  await expect(verifyAuthenticatedBackup({...backup,trustedPublicKeyPem:pem})).rejects.toThrow('TRUSTED_PUBLIC_KEY_REQUIRED');
 }));
 it('preserves the initial blocked restore decision despite later observation mutation',()=>fixture(async({backup})=>{
  const observed={...empty};const identity={schema_version:1,installation_id:B};
  const pending=preflightAuthenticatedRestore({backup,observed,localIdentity:identity,intent:'restore-same'});
  Object.assign(observed,live);identity.installation_id=A;
  const r=await pending;expect(r.decision).toMatchObject({decision:'BLOCKED',reason:'CROSS_INSTALLATION_RESTORE_FORBIDDEN'});
 }));
});
