#!/usr/bin/env node
// LAN-01 read-only bundle integrity preflight. Does not install, fetch, execute,
// trust a manifest merely because it is present, or prove publisher signatures.
// The trusted manifest SHA-256 MUST be obtained out of band from the release owner.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, opendir } from 'node:fs/promises';
import { resolve, relative, sep, isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 10000;
const HEX256 = /^[a-fA-F0-9]{64}$/;
const VALID_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+\/-]*$/;
const WINDOWS_RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
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
  // Prevent Windows drive/UNC, DOS special device names (including extensions),
  // and portable case-insensitive collision ambiguity.
  if (name.includes(':')) fail('Windows drive or special path not supported');
  if (name.split('/').some(part => WINDOWS_RESERVED_DEVICE.test(part)))
    fail('Windows reserved device filename not permitted');
  return name;
}

function exactKeys(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      Object.keys(object).sort().join('|') !== [...keys].sort().join('|')) {
    fail('Unsupported manifest schema or unexpected fields');
  }
}


function rejectDuplicateJsonKeys(source) {
  // JSON.parse accepts duplicate keys and keeps the last value. Reject that
  // ambiguity before using a cross-platform release manifest.
  let offset = 0;
  const whitespace = () => {
    while (offset < source.length && /[\t\r\n ]/.test(source[offset])) offset++;
  };
  const string = () => {
    const from = offset++;
    while (offset < source.length) {
      if (source[offset] === '\\') { offset += 2; continue; }
      if (source[offset++] === '"') return JSON.parse(source.slice(from, offset));
    }
    fail('Invalid JSON string');
  };
  const value = (depth = 0) => {
    if (depth > 64) fail('Manifest JSON nesting limit exceeded');
    whitespace();
    if (source[offset] === '{') {
      offset++;
      const keys = new Set();
      whitespace();
      if (source[offset] === '}') { offset++; return; }
      while (true) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail('Duplicate JSON object key in LAN manifest');
        keys.add(key);
        whitespace();
        if (source[offset++] !== ':') fail('Malformed JSON object');
        value(depth + 1);
        whitespace();
        const separator = source[offset++];
        if (separator === '}') return;
        if (separator !== ',') fail('Malformed JSON object separator');
      }
    }
    if (source[offset] === '[') {
      offset++;
      whitespace();
      if (source[offset] === ']') { offset++; return; }
      while (true) {
        value(depth + 1);
        whitespace();
        const separator = source[offset++];
        if (separator === ']') return;
        if (separator !== ',') fail('Malformed JSON array separator');
      }
    }
    if (source[offset] === '"') { string(); return; }
    const from = offset;
    while (offset < source.length && !/[\s,\]}]/.test(source[offset])) offset++;
    if (from === offset) fail('Malformed JSON value');
  };
  value();
  whitespace();
  if (offset !== source.length) fail('Malformed JSON manifest trailing content');
}

async function assertRegularNoLinks(file, label) {
  const info = await lstat(file);
  // Symlinks are not the only alias risk: a hard link lets an outside path
  // mutate the same inode after verification. Offline payload/manifest files
  // must have exactly one link before the verifier reads them.
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1)
    fail(label + ' must be a regular single-link file');
  return info;
}

// Keep directory traversal bounded independently of the declared file count.
// Extra empty trees have no authenticated payload bytes, but could otherwise
// exhaust memory, file descriptors, or the call stack during an offline scan.
const MAX_SCAN_DEPTH = 64;
const MAX_EXTRA_TREE_ENTRIES = 128;

async function walkExactPayload(root, expectedPaths) {
  const observed = new Set();
  // One distinct parent directory per manifested file is already generous;
  // allow a small fixed overhead for harmless empty directories.
  const maxEntries = expectedPaths.size * 2 + MAX_EXTRA_TREE_ENTRIES;
  const stack = [{dir: root, depth: 0}];
  let seenEntries = 0;
  while (stack.length) {
    const {dir, depth} = stack.pop();
    // opendir streams directory entries rather than materializing an untrusted
    // directory with unbounded readdir() memory in one operation.
    for await (const item of await opendir(dir)) {
      if (++seenEntries > maxEntries) fail('Too many payload directory entries');
      if (item.isSymbolicLink()) fail('Symlink inside payload is not permitted');
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        if (depth + 1 > MAX_SCAN_DEPTH) fail('Payload directory nesting limit exceeded');
        stack.push({dir: full, depth: depth + 1});
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
  if (observed.size !== expectedPaths.size) fail('Manifested payload files are missing');
}

// Bounded descriptor reads prevent a concurrently growing manifest/signature
// from exhausting memory before the independently approved digest is checked.
async function readBoundedRegular(file, max, label) {
  const info = await assertRegularNoLinks(file, label);
  if (info.size < 1 || info.size > max) fail(label + ' exceeds allowed size or is empty');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) |
    (constants.O_NONBLOCK || 0));
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink !== 1 ||
        ['dev','ino','size','mtimeMs','ctimeMs'].some(k => st[k] !== info[k])) fail(label + ' changed during validation');
    const bytes = Buffer.alloc(st.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const {bytesRead} = await handle.read(bytes,count,bytes.length-count,count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    const after = await handle.stat(), current = await lstat(file);
    if (count !== st.size || !after.isFile() || !current.isFile() ||
        after.nlink !== 1 || current.nlink !== 1 ||
        [after,current].some(x => ['dev','ino','size','mtimeMs','ctimeMs'].some(k=>x[k]!==st[k])))
      fail(label + ' changed during validation');
    return bytes.subarray(0,count);
  } finally { await handle.close(); }
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

  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);
  const handle = await open(file, flags);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink !== 1 || st.size !== expectedSize ||
        st.dev !== info.dev || st.ino !== info.ino) {
      fail('Payload changed during validation');
    }
    const hash = createHash('sha256');
    let size = 0;
    const chunk = Buffer.alloc(1024*1024);
    while (size <= expectedSize) {
      const {bytesRead} = await handle.read(chunk,0,Math.min(chunk.length,expectedSize-size+1),size);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > expectedSize) fail('Payload byte count changed during validation');
      hash.update(chunk.subarray(0,bytesRead));
    }
    if (size !== expectedSize) fail('Payload byte count changed during validation');
    // Recheck the open descriptor and current pathname. This detects common
    // file replacement/mutation during read; it does NOT make a later
    // privileged install atomic against concurrent untrusted writers.
    const after = await handle.stat();
    const current = await lstat(file);
    if (!after.isFile() || after.nlink !== 1 ||
        after.dev !== st.dev || after.ino !== st.ino ||
        after.size !== expectedSize ||
        after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs ||
        current.isSymbolicLink() || !current.isFile() || current.nlink !== 1 ||
        current.dev !== st.dev || current.ino !== st.ino) {
      fail('Payload changed during validation');
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

export async function verifyLanBundle({manifest, root, trustedManifestSha256}) {
  if (typeof trustedManifestSha256 !== 'string' || trustedManifestSha256.length !== 64 || !HEX256.test(trustedManifestSha256)) fail('Trusted manifest digest must be 64 hex characters');
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
  const bytes = await readBoundedRegular(manifestPath, MAX_MANIFEST_BYTES, 'Manifest');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== trustedManifestSha256.toLowerCase())
    fail('Manifest SHA-256 does not match the externally trusted digest');
  let doc;
  const manifestText = bytes.toString('utf8');
  try { doc = JSON.parse(manifestText); }
  catch { fail('Invalid JSON manifest'); }
  rejectDuplicateJsonKeys(manifestText);
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

// Publisher verification is a separate, stricter entry point. Both the
// signer fingerprint and exact approved release manifest digest come from
// an independently authenticated release record, not the bundle itself.
export async function verifySignedLanBundle({manifest,root,signature,
  trustedManifestSha256,trustedPublicKeyPem,trustedSignerSpkiSha256}) {
  if (typeof trustedSignerSpkiSha256 !== 'string' || trustedSignerSpkiSha256.length !== 64 ||
      !HEX256.test(trustedSignerSpkiSha256)) fail('Trusted publisher signer pin required');
  if (typeof trustedManifestSha256 !== 'string' || trustedManifestSha256.length !== 64 ||
      !HEX256.test(trustedManifestSha256)) fail('Independently approved manifest digest required');
  if (typeof trustedPublicKeyPem !== 'string' || trustedPublicKeyPem.length > 8192 ||
      !trustedPublicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n')) fail('Trusted publisher public key required');
  const key = createPublicKey(trustedPublicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') fail('Unsupported publisher signing algorithm');
  const pin = createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
  if (pin !== trustedSignerSpkiSha256.toLowerCase()) fail('Publisher signer pin mismatch');
  const signaturePath = resolve(signature), rootPath = resolve(root);
  const signatureRelative = relative(rootPath,signaturePath);
  if (!signatureRelative || (!signatureRelative.startsWith('..'+sep) &&
      signatureRelative !== '..' && !isAbsolute(signatureRelative))) fail('Signature must be outside payload root');
  const manifestBytes = await readBoundedRegular(resolve(manifest),MAX_MANIFEST_BYTES,'Manifest');
  const digest = createHash('sha256').update(manifestBytes).digest('hex');
  if (digest !== trustedManifestSha256.toLowerCase()) fail('Manifest not independently approved');
  const sig = await readBoundedRegular(signaturePath,64,'Signature');
  if (sig.length !== 64 || !verify(null,manifestBytes,key,sig)) fail('Publisher manifest signature invalid');
  // Re-reading is intentional: the same approved digest binds the exact
  // bytes the existing verifier parses, including duplicate-key rejection.
  const content = await verifyLanBundle({manifest,root,trustedManifestSha256:digest});
  return Object.freeze({verified:content.verified,files:content.files,
    publisher_signature_verified:true,payload_integrity_verified:true,
    approved_manifest_sha256:digest,signer_spki_sha256:pin,
    installation_authorized:false,host_runtime_verified:false,
    offline_execution_verified:false});
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    process.stderr.write('LAN bundle verification FAILED: ' + err.message + '\n');
    process.exitCode = 1;
  });
}
