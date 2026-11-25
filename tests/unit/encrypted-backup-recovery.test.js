import {describe,it,expect} from 'vitest';
import {randomBytes,generateKeyPairSync,createHash,sign} from 'node:crypto';
import {mkdtemp,chmod,writeFile,readFile,rm,realpath,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEncryptedBackup,recoverEncryptedBackup} from '../../scripts/encrypted-backup-recovery.mjs';
import {canonicalBackupManifest} from '../../scripts/authenticated-backup-preflight.mjs';
const A='6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e';
const B='e6e99999-1234-4bcd-8123-0123456789ab';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(run){
 const directory=await mkdtemp(join(await realpath(tmpdir()),'itk-encrypted-'));
 const key=randomBytes(32);
 try{
  await chmod(directory,0o700);
  const plaintext=Buffer.from('synthetic backup contents');
  await writeFile(join(directory,'source.bin'),plaintext,{mode:0o600});
  const input={directory,inputName:'source.bin',outputName:'backup.bin',key,installationId:A,backupId:B,createdAt:'2026-11-24T00:00:00.000Z'};
  const result=await createEncryptedBackup(input);
  const signer=generateKeyPairSync('ed25519');
  const backup={manifestPath:join(directory,'manifest.json'),signaturePath:join(directory,'manifest.sig'),
   payloadPath:join(directory,'backup.bin'),expectedInstallationId:A,
   trustedPublicKeyPem:signer.publicKey.export({type:'spki',format:'pem'}),
   trustedSignerSpkiSha256:sha(signer.publicKey.export({type:'spki',format:'der'}))};
  const publish=async manifest=>{
   await writeFile(backup.manifestPath,manifest,{mode:0o600});
   await writeFile(backup.signaturePath,sign(null,manifest,signer.privateKey),{mode:0o600});
  };
  await publish(result.manifest);
  const recover={directory,outputName:'recovered.bin',key,backup,expectedBackupId:B,confirmation:'RECOVER_TO_PRIVATE_STAGING_ONLY'};
  await run({input,result,plaintext,recover,publish,directory,backup});
 }finally{key.fill(0);await rm(directory,{recursive:true,force:true})}
}
describe.skipIf(process.platform==='win32')('bounded encrypted backup private staging reference',()=>{
 it('real AES-GCM and signed manifest round trip; no overwrite or live restore',()=>fixture(async f=>{
  expect(f.result.manifest_signed).toBe(false);
  const ciphertext=await readFile(f.backup.payloadPath);
  expect(ciphertext.includes(f.plaintext)).toBe(false);
  expect(await recoverEncryptedBackup(f.recover)).toMatchObject({encryption_verified:true,restore_authorized:false});
  expect(await readFile(join(f.directory,'recovered.bin'))).toEqual(f.plaintext);
  expect((await stat(join(f.directory,'recovered.bin'))).mode&0o777).toBe(0o600);
  await expect(recoverEncryptedBackup(f.recover)).rejects.toThrow();
  await expect(createEncryptedBackup(f.input)).rejects.toThrow();
  expect(await readFile(f.backup.payloadPath)).toEqual(ciphertext);
 }));
 it('wrong key and missing explicit consent leave no recovered output',()=>fixture(async f=>{
  await expect(recoverEncryptedBackup({...f.recover,key:randomBytes(32)})).rejects.toThrow('BACKUP_AEAD_AUTHENTICATION_FAILED');
  await expect(recoverEncryptedBackup({...f.recover,confirmation:undefined})).rejects.toThrow('EXPLICIT_STAGING_RECOVERY_REQUIRED');
  expect(await readdir(f.directory)).not.toContain('recovered.bin');
  expect((await readdir(f.directory)).some(n=>n.endsWith('.tmp'))).toBe(false);
 }));
 it('rejects tampering even if modified ciphertext has a valid replacement signature',()=>fixture(async f=>{
  const bytes=await readFile(f.backup.payloadPath);bytes[bytes.length-17]^=1;
  await writeFile(f.backup.payloadPath,bytes);
  await expect(recoverEncryptedBackup(f.recover)).rejects.toThrow('BACKUP_PAYLOAD_DIGEST_MISMATCH');
  const manifest=JSON.parse(f.result.manifest.toString());
  await f.publish(canonicalBackupManifest({...manifest,payload_sha256:sha(bytes)}));
  await expect(recoverEncryptedBackup(f.recover)).rejects.toThrow('BACKUP_AEAD_AUTHENTICATION_FAILED');
  expect(await readdir(f.directory)).not.toContain('recovered.bin');
 }));
 it('rejects wrong backup selection and unsafe staging paths',()=>fixture(async f=>{
  await expect(recoverEncryptedBackup({...f.recover,expectedBackupId:A})).rejects.toThrow('APPROVED_BACKUP_BYTES_OR_ID_MISMATCH');
  await expect(recoverEncryptedBackup({...f.recover,outputName:'../outside'})).rejects.toThrow('LOCAL_STAGING_FILENAME_REQUIRED');
  await chmod(f.directory,0o755);
  await expect(recoverEncryptedBackup(f.recover)).rejects.toThrow('PRIVATE_STAGING_REQUIRED');
 }));
});
