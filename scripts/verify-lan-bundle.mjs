#!/usr/bin/env node
// LAN-01 read-only bundle integrity preflight. Does not install, fetch, execute,
// trust a manifest merely because it is present, or prove publisher signatures.
// The trusted manifest SHA-256 MUST be obtained out of band from the release owner.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, sep, isAbsolute, join, dirname } from 'node:path';

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 10000;
const HEX256 = /^[a-fA-F0-9]{64}$/;
const VALID_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+\/-]*$/;
const REQUIRED_ARGS = ['--manifest', '--root', '--trusted-manifest-sha256'];

function fail(message) {
  throw new Error(message);
}

function strictArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!REQUIRED_ARGS.includes(key) || i + 1 >= argv.length ||
        Object.hasOwn(options, key) || !argv[i + 1] ||
        argv[i + 1].startsWith('--')) {
      fail('Usage: node scripts/verify-lan-bundle.mjs --manifest FILE --root PAYLOAD_DIR --trusted-manifest-sha256 64_HEX_DIGEST');
    }
    options[key] = argv[i + 1];
  }
  if (Object.keys(options).length !== REQUIRED_ARGS.length ||
      !HEX256.test(options['--trusted-manifest-sha256'])) {
    fail('Manifest path, payload root and out-of-band 64-hex trusted manifest SHA-256 are required');
  }
  return options;
}

function safeEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 1024 ||
      !VALID_NAME.test(name) || isAbsolute(name) ||
      name.includes('\\') || name.includes('//') ||
      name.split('/').some(part => part === '.' || part === '..' ||
        part.endsWith('.') || part.endsWith(' ') || part === '')) {
    fail('Invalid relative payload entry path');
  }
  // Prevent Windows drive/UNC and portable case-insensitive collision ambiguity.
  if (name.includes(':')) fail('Windows drive or special path not supported');
  return name;
}

function exactKeys(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      Object.keys(object).sort().join('|') !== [...keys].sort().join('|')) {
    fail('Unsupported manifest schema or unexpected fields');
  }
}

async function assertRegularNoLinks(file, label) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) fail(label + ' is not a regular non-link file');
  return info;
}

async function walkExactPayload(root, expectedPaths) {
  const observed = new Set();
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) fail('Symlink inside payload is not permitted');
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile()) {
        const rel = relative(root, full).split(sep).join('/');
        const canonical = rel.toLowerCase();
        if (!expectedPaths.has(canonical)) fail('Unexpected unmanifested payload file');
        if (observed.has(canonical)) fail('Duplicate/case-colliding payload file');
        observed.add(canonical);
      } else {
        fail('Non-regular payload filesystem entry is not permitted');
      }
    }
  }
  await walk(root);
  if (observed.size !== expectedPaths.size) fail('Manifested payload files are missing');
}

async function digestFile(file, expectedSize) {
  // Reject symlinks in each component, including a directory/junction segment.
  let part = dirname(file);
  const dirs = [];
  while (part !== dirname(part)) {
    dirs.push(part);
    part = dirname(part);
  }
  for (const dir of dirs) {
    const s = await lstat(dir);
    if (s.isSymbolicLink() || !s.isDirectory()) fail('Payload parent path contains a link or non-directory');
  }
  const info = await assertRegularNoLinks(file, 'Payload item');
  if (info.size !== expectedSize) fail('Payload file size mismatch');

  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0);
  const handle = await open(file, flags);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size !== expectedSize) fail('Payload changed during validation');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      hash.update(chunk);
    }
    if (size !== expectedSize) fail('Payload byte count changed during validation');
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

export async function verifyLanBundle({manifest, root, trustedManifestSha256}) {
  if (!HEX256.test(trustedManifestSha256 || '')) fail('Trusted manifest digest must be 64 hex characters');
  const manifestPath = resolve(manifest);
  const rootPath = resolve(root);
  const stat = await lstat(rootPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Payload root must be a real directory, not a symlink');
  // An expected digest must refer to the manifest, not an untrusted manifest
  // that can replace its own checksum. Keep it outside the payload tree.
  const manifestRelative = relative(rootPath, manifestPath);
  if (manifestRelative === '' || (!manifestRelative.startsWith('..' + sep) &&
      manifestRelative !== '..' && !isAbsolute(manifestRelative))) {
    fail('Manifest must be outside payload root');
  }
  const minfo = await assertRegularNoLinks(manifestPath, 'Manifest');
  if (minfo.size > MAX_MANIFEST_BYTES) fail('Manifest exceeds allowed size');
  const bytes = await readFile(manifestPath);
  if (bytes.length !== minfo.size || bytes.length > MAX_MANIFEST_BYTES)
    fail('Manifest changed during validation');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== trustedManifestSha256.toLowerCase())
    fail('Manifest SHA-256 does not match the externally trusted digest');
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); }
  catch { fail('Invalid JSON manifest'); }
  exactKeys(doc, ['schema_version', 'installation_mode', 'files']);
  if (doc.schema_version !== 1 || doc.installation_mode !== 'intranet' ||
      !Array.isArray(doc.files) || !doc.files.length || doc.files.length > MAX_FILES)
    fail('Unsupported LAN bundle schema/version or file count');
  const expected = new Set();
  for (const entry of doc.files) {
    exactKeys(entry, ['path', 'size', 'sha256']);
    const name = safeEntryName(entry.path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !HEX256.test(entry.sha256))
      fail('Invalid entry size or checksum');
    const canonical = name.toLowerCase();
    if (expected.has(canonical)) fail('Duplicate or case-colliding payload entry');
    expected.add(canonical);
    const target = resolve(rootPath, ...name.split('/'));
    const rel = relative(rootPath, target);
    if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel))
      fail('Payload path escapes bundle root');
    const measured = await digestFile(target, entry.size);
    if (measured !== entry.sha256.toLowerCase()) fail('Payload SHA-256 mismatch');
  }
  // A signed manifest only protects declared entries; reject unexpected files
  // so an installer cannot accidentally execute an unchecked extra payload.
  await walkExactPayload(rootPath, expected);
  return { verified: true, files: expected.size, content_integrity_only: true };
}

async function main() {
  const args = strictArgs(process.argv.slice(2));
  const result = await verifyLanBundle({
    manifest: args['--manifest'],
    root: args['--root'],
    trustedManifestSha256: args['--trusted-manifest-sha256']
  });
  process.stdout.write('LAN bundle payload verified: ' + result.files +
    ' declared files. SHA-256 integrity only; publisher signature, TLS, installer and host checks NOT verified.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch(err => {
    process.stderr.write('LAN bundle verification FAILED: ' + err.message + '\n');
    process.exitCode = 1;
  });
}
