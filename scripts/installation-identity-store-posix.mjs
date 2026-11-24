// Reference POSIX storage adapter. No runtime integration or Windows ACL
// claim. Caller must hold the trusted installer lock and verify observed
// service/database/credential state. Never create or replace a live DB.
import { constants } from 'node:fs';
import { lstat, realpath, open, link, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { planInstallationIdentity, validateInstallationIdentity } from './installation-identity.mjs';

const FILE = 'installation-identity.json';
async function privateDirectory(directory) {
  if (typeof process.geteuid !== 'function' || !constants.O_NOFOLLOW) throw new Error('POSIX_PRIVATE_STORAGE_REQUIRED');
  const full = resolve(directory);
  const st = await lstat(full);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.geteuid() ||
      (st.mode & 0o777) !== 0o700 || await realpath(full) !== full) {
    throw new Error('IDENTITY_DIRECTORY_NOT_PRIVATE');
  }
  return full;
}
export async function readInstallationIdentity(directory) {
  const full = await privateDirectory(directory);
  let fd;
  try {
    fd = await open(join(full, FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const st = await fd.stat();
    if (!st.isFile() || st.uid !== process.geteuid() || (st.mode & 0o777) !== 0o600 ||
        st.nlink !== 1 || st.size < 1 || st.size > 1024) throw new Error('IDENTITY_FILE_NOT_PRIVATE_OR_VALID');
    const bytes = await fd.readFile({ encoding:'utf8' });
    if (Buffer.byteLength(bytes) !== st.size) throw new Error('IDENTITY_FILE_CHANGED');
    return validateInstallationIdentity(JSON.parse(bytes));
  } finally { await fd.close(); }
}
export async function initializeFreshInstallationIdentity(directory, observed) {
  const full = await privateDirectory(directory);
  const localIdentity = await readInstallationIdentity(full);
  const plan = planInstallationIdentity({intent:'fresh', observed, localIdentity});
  if (plan.reason !== 'GENERATE_NEW_IDENTITY') throw new Error(plan.reason);
  const identity = validateInstallationIdentity({schema_version:1, installation_id:randomUUID()});
  const tmp = join(full, '.identity-' + randomUUID() + '.tmp');
  let fd;
  try {
    fd = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await fd.chmod(0o600);
    await fd.writeFile(JSON.stringify(identity) + '\n', 'utf8');
    await fd.sync();
    await fd.close(); fd = undefined;
    // Atomic no-replacement publication. A concurrent creator cannot
    // overwrite the winner. No rename-overwrite or silent identity rotation.
    await link(tmp, join(full, FILE));
  } finally {
    if (fd) await fd.close();
    try { await unlink(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const dirfd = await open(full, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await dirfd.sync(); } finally { await dirfd.close(); }
  return identity;
}
