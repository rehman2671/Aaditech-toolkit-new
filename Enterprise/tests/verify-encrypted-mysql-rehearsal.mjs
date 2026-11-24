// Disposable CI only: encrypt, sign, authenticate and recover the actual SQL
// dump, then let the isolated shell rehearsal explicitly authorize import.
// All encryption/signing keys are ephemeral and never exported or printed.
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {readFile,writeFile,stat,realpath,readdir} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {createEncryptedBackup,recoverEncryptedBackup,MAX_PLAINTEXT_BYTES} from '../../scripts/encrypted-backup-recovery.mjs';

if(process.env.AADITECH_REHEARSAL!=='isolated-ci'||process.argv.length!==4)
  throw Error('ISOLATED_CI_ONLY');
const [sourceArg,dirArg]=process.argv.slice(2);
const source=resolve(sourceArg),directory=resolve(dirArg),name=basename(source);
assert.match(name,/^ittoolkit-[0-9-]+\.sql$/);
assert.equal(await realpath(source),source);
assert.equal(await realpath(directory),directory);
assert.deepEqual(await readdir(directory),[]);
const info=await stat(source);
assert(info.isFile()&&info.size>0&&info.size<=MAX_PLAINTEXT_BYTES);
const bytes=await readFile(source);
assert(bytes.subarray(0,100).toString('utf8').startsWith('-- aaditech-mysql-backup-v1 database=it_toolkit_rehearsal\n'));
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal((await readFile(source+'.sha256','utf8')).trimEnd(),sha(bytes)+'  '+name);
const key=randomBytes(32),wrongKey=randomBytes(32);
try {
  await writeFile(join(directory,'input.sql'),bytes,{mode:0o600,flag:'wx'});
  const installationId=randomUUID(),backupId=randomUUID();
  const created=await createEncryptedBackup({directory,inputName:'input.sql',outputName:'encrypted.bin',key,
    installationId,backupId,createdAt:new Date().toISOString()});
  assert.equal(created.restore_authorized,false);
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const manifestPath=join(directory,'manifest.json'),signaturePath=join(directory,'manifest.sig');
  await writeFile(manifestPath,created.manifest,{mode:0o600,flag:'wx'});
  await writeFile(signaturePath,sign(null,created.manifest,privateKey),{mode:0o600,flag:'wx'});
  const backup={manifestPath,signaturePath,payloadPath:join(directory,'encrypted.bin'),
    expectedInstallationId:installationId,trustedPublicKeyPem:publicKey.export({type:'spki',format:'pem'}),
    trustedSignerSpkiSha256:sha(publicKey.export({type:'spki',format:'der'}))};
  const options={directory,outputName:name,key,backup,expectedBackupId:backupId,confirmation:'RECOVER_TO_PRIVATE_STAGING_ONLY'};
  await assert.rejects(()=>recoverEncryptedBackup({...options,key:wrongKey}),/BACKUP_AEAD_AUTHENTICATION_FAILED/);
  assert(!(await readdir(directory)).includes(name));
  const result=await recoverEncryptedBackup(options);
  assert.equal(result.encryption_verified,true);
  assert.equal(result.restore_authorized,false);
  const recovered=await readFile(join(directory,name));
  assert(recovered.equals(bytes));
  await writeFile(join(directory,name+'.sha256'),sha(recovered)+'  '+name+'\n',{mode:0o600,flag:'wx'});
  recovered.fill(0);
  console.log('[rehearsal] Authenticated AES-GCM actual disposable MySQL dump recovery verified; no production approval.');
} finally {key.fill(0);wrongKey.fill(0);bytes.fill(0);}
