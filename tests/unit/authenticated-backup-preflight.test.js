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
