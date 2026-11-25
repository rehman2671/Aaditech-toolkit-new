// Offline, read-only backup provenance preflight. Not a restore executor.
// Trust the signer pin and allowed installation ID from an independent
// authenticated recovery record, NEVER from the backup package itself.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateInstallationIdentity, planInstallationIdentity } from './installation-identity.mjs';

const HEX = /^[a-f0-9]{64}$/;
const MAX_MANIFEST = 4096;
const MAX_PAYLOAD = 1024 ** 4; // 1 TiB explicit safety ceiling for this reference
const fail = code => { throw new Error(code); };
const exactHex = s => typeof s === 'string' && s.length === 64 && HEX.test(s);
const uuid = s => validateInstallationIdentity({schema_version:1,installation_id:s}).installation_id;

export function canonicalBackupManifest(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      Object.keys(record).length !== 7 || record.schema_version !== 1 ||
      record.format !== 'encrypted-backup-container' ||
      typeof record.created_at !== 'string' || record.created_at.length !== 24 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.created_at) ||
      !Number.isFinite(Date.parse(record.created_at)) ||
      new Date(record.created_at).toISOString() !== record.created_at ||
      !Number.isSafeInteger(record.payload_size) || record.payload_size < 1 ||
      record.payload_size > MAX_PAYLOAD || !exactHex(record.payload_sha256)) {
    fail('INVALID_BACKUP_MANIFEST');
  }
  return Buffer.from(JSON.stringify({
    schema_version:1,
    installation_id:uuid(record.installation_id),
    backup_id:uuid(record.backup_id),
    created_at:record.created_at,
    format:record.format,
    payload_size:record.payload_size,
    payload_sha256:record.payload_sha256
  }) + '\n', 'utf8');
}

async function openRegular(path, maximum) {
  const full = resolve(path);
  // Reject aliases including symlinked ancestors. Caller must stage all
  // files in a private, immutable recovery directory and hold its lock.
  if (await realpath(full) !== full) fail('BACKUP_PATH_ALIAS');
  const before = await lstat(full);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.size < 1 || before.size > maximum) fail('INVALID_BACKUP_FILE');
  const fd = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) |
    (constants.O_NONBLOCK || 0));
  try {
    const st = await fd.stat();
    if (!st.isFile() || st.nlink !== 1 || st.dev !== before.dev ||
        st.ino !== before.ino || st.size !== before.size ||
        st.mtimeMs !== before.mtimeMs || st.ctimeMs !== before.ctimeMs) {
      fail('BACKUP_FILE_CHANGED');
    }
    return {fd, st, full};
  } catch (err) { await fd.close(); throw err; }
}
async function unchanged({fd,st,full}) {
  const after = await fd.stat(), current = await lstat(full);
  if (!after.isFile() || after.nlink !== 1 || !current.isFile() ||
      current.isSymbolicLink() || current.nlink !== 1 ||
      [after,current].some(s => s.dev !== st.dev || s.ino !== st.ino ||
        s.size !== st.size || s.mtimeMs !== st.mtimeMs || s.ctimeMs !== st.ctimeMs)) {
    fail('BACKUP_FILE_CHANGED');
  }
}
async function readSmall(path, max) {
  const file = await openRegular(path,max);
  try {
    const bytes = Buffer.alloc(file.st.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const {bytesRead} = await file.fd.read(bytes,count,bytes.length-count,count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count !== file.st.size) fail('BACKUP_FILE_CHANGED');
    await unchanged(file);
    return bytes.subarray(0,count);
  } finally { await file.fd.close(); }
}
async function verifyPayload(path, record) {
  const file = await openRegular(path,record.payload_size);
  try {
    if (file.st.size !== record.payload_size) fail('BACKUP_PAYLOAD_SIZE_MISMATCH');
    const hash = createHash('sha256');
    const chunk = Buffer.alloc(1024*1024);
    let total = 0;
    // Read at most signed size + one byte, even if another writer appends.
    while (total <= record.payload_size) {
      const {bytesRead} = await file.fd.read(chunk,0,
        Math.min(chunk.length,record.payload_size-total+1),total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > record.payload_size) fail('BACKUP_PAYLOAD_SIZE_MISMATCH');
      hash.update(chunk.subarray(0,bytesRead));
    }
    if (total !== record.payload_size) fail('BACKUP_PAYLOAD_SIZE_MISMATCH');
    await unchanged(file);
    if (hash.digest('hex') !== record.payload_sha256) fail('BACKUP_PAYLOAD_DIGEST_MISMATCH');
  } finally { await file.fd.close(); }
}

export async function verifyAuthenticatedBackup({
  manifestPath, signaturePath, payloadPath, trustedPublicKeyPem,
  trustedSignerSpkiSha256, expectedInstallationId
}) {
  if (!exactHex(trustedSignerSpkiSha256)) fail('TRUSTED_SIGNER_PIN_REQUIRED');
  const expected = uuid(expectedInstallationId);
  if (typeof trustedPublicKeyPem !== 'string' || trustedPublicKeyPem.length > 8192 ||
      !trustedPublicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n')) fail('TRUSTED_PUBLIC_KEY_REQUIRED');
  const publicKey = createPublicKey(trustedPublicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') fail('UNSUPPORTED_BACKUP_SIGNER');
  const pin = createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
  if (pin !== trustedSignerSpkiSha256) fail('BACKUP_SIGNER_PIN_MISMATCH');
  const manifest = await readSmall(manifestPath,MAX_MANIFEST);
  const signature = await readSmall(signaturePath,64);
  if (signature.length !== 64 || !verify(null,manifest,publicKey,signature)) fail('BACKUP_SIGNATURE_INVALID');
  const record = JSON.parse(manifest.toString('utf8'));
  // Exactly canonical bytes eliminate duplicate/escaped keys, extra fields,
  // alternate number encodings, BOM and ambiguous Unicode representations.
  if (!manifest.equals(canonicalBackupManifest(record))) fail('BACKUP_MANIFEST_NOT_CANONICAL');
  if (record.installation_id !== expected) fail('BACKUP_INSTALLATION_MISMATCH');
  await verifyPayload(payloadPath,record);
  return Object.freeze({
    authenticated_manifest:true,
    payload_integrity_verified:true,
    encryption_verified:false,
    freshness_or_fencing_verified:false,
    mutation_authorized:false,
    identity:Object.freeze({schema_version:1,installation_id:record.installation_id}),
    backup_id:record.backup_id,
    created_at:record.created_at,
    payload_size:record.payload_size,
    payload_sha256:record.payload_sha256,
    signer_spki_sha256:pin
  });
}

export async function preflightAuthenticatedRestore({backup, observed, localIdentity=null,
  previousInstanceFenced=false, intent}) {
  if (intent !== 'restore-same' && intent !== 'clone-new') fail('EXPLICIT_RESTORE_INTENT_REQUIRED');
  const evidence = await verifyAuthenticatedBackup(backup);
  const decision = planInstallationIdentity({intent,observed,localIdentity,
    backupIdentity:evidence.identity,previousInstanceFenced});
  return Object.freeze({evidence,decision,mutation_authorized:false});
}
