import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyLanBundle } from '../../scripts/verify-lan-bundle.mjs';

const script = fileURLToPath(new URL('../../scripts/verify-lan-bundle.mjs', import.meta.url));
const sha = x => createHash('sha256').update(x).digest('hex');
const dirs = [];
const fresh = async (entries = [{path: 'images/agent.tar', content: 'verified-agent'}]) => {
  const temp = await mkdtemp(join(tmpdir(), 'aaditech-lan-manifest-'));
  dirs.push(temp);
  const root = join(temp, 'payload');
  await mkdir(root);
  const files = [];
  for (const item of entries) {
    const full = join(root, ...item.path.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, item.content);
    files.push({path: item.path, size: Buffer.byteLength(item.content), sha256: sha(item.content)});
  }
  const manifest = join(temp, 'manifest.json');
  const bytes = Buffer.from(JSON.stringify({ schema_version: 1, installation_mode: 'intranet', files }));
  await writeFile(manifest, bytes);
  const trustedManifestSha256 = sha(bytes);
  return {temp, root, manifest, files, trustedManifestSha256};
};
const cli = (fixture, args = []) => spawnSync(process.execPath,
  [script, '--manifest', fixture.manifest, '--root', fixture.root,
    '--trusted-manifest-sha256', fixture.trustedManifestSha256, ...args],
  { encoding: 'utf8', timeout: 5000 });
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop(), {force:true,recursive:true});
});

describe('LAN-01 offline payload integrity verifier', () => {
  it('accepts only the supplied trusted out-of-band manifest digest', async () => {
    const f = await fresh();
    expect(await verifyLanBundle(f)).toEqual({
      verified: true, files: 1, content_integrity_only: true
    });
    const cmd = cli(f);
    expect(cmd.status).toBe(0);
    expect(cmd.stdout).toContain('SHA-256 integrity only');
  });

  it('refuses a missing trusted digest, an unknown option, and duplicates', async () => {
    const f = await fresh();
    const noTrust = spawnSync(process.execPath, [script, '--manifest', f.manifest, '--root', f.root],
      { encoding:'utf8', timeout:5000 });
    expect(noTrust.status).not.toBe(0);
    expect(noTrust.stderr).toContain('FAILED');
    expect(cli(f, ['--extra', 'x']).status).not.toBe(0);
    expect(cli(f, ['--root', f.root]).status).not.toBe(0);
  });

  it('rejects manifest tampering without mutating the payload', async () => {
    const f = await fresh();
    const original = await readFile(join(f.root, 'images/agent.tar'));
    await writeFile(f.manifest, JSON.stringify({ schema_version:1, installation_mode:'intranet',
      files: [{path:'images/agent.tar', size:0, sha256:sha('')}]}));
    expect(cli(f).status).not.toBe(0);
    expect(await readFile(join(f.root, 'images/agent.tar'))).toEqual(original);
  });

  it('rejects payload tampering, wrong byte sizes and unmanifested extras', async () => {
    const f = await fresh();
    await writeFile(join(f.root,'images/agent.tar'), 'other-content');
    await expect(verifyLanBundle(f)).rejects.toThrow(/size mismatch|SHA-256 mismatch/);
    await writeFile(join(f.root,'images/agent.tar'), 'verified-agent');
    await writeFile(join(f.root, 'extra.txt'), 'unsigned');
    await expect(verifyLanBundle(f)).rejects.toThrow('Unexpected unmanifested payload file');
  });

  it('rejects path traversal and manifests inside the payload root', async () => {
    const f = await fresh();
    const doc = JSON.parse(await readFile(f.manifest, 'utf8'));
    doc.files[0].path = '../outside';
    await writeFile(f.manifest, JSON.stringify(doc));
    f.trustedManifestSha256 = sha(await readFile(f.manifest));
    await expect(verifyLanBundle(f)).rejects.toThrow(/Invalid relative/);
    const inside = join(f.root,'manifest.json');
    await writeFile(inside, await readFile(f.manifest));
    await expect(verifyLanBundle({...f,manifest:inside})).rejects.toThrow('outside payload root');
  });

  it('rejects duplicate case-insensitive paths even if present on Linux', async () => {
    const f=await fresh();
    const doc=JSON.parse(await readFile(f.manifest,'utf8'));
    doc.files.push({...doc.files[0],path:'IMAGES/AGENT.TAR'});
    await writeFile(f.manifest, JSON.stringify(doc));
    f.trustedManifestSha256 = sha(await readFile(f.manifest));
    await expect(verifyLanBundle(f)).rejects.toThrow(/Duplicate or case-colliding/);
  });

  it('rejects Windows special device paths even on Linux builders', async () => {
    const f = await fresh();
    const doc = JSON.parse(await readFile(f.manifest, 'utf8'));
    for (const candidate of ['CON', 'NUL.txt', 'images/COM1.tar', 'lpt9']) {
      doc.files[0].path = candidate;
      await writeFile(f.manifest, JSON.stringify(doc));
      f.trustedManifestSha256 = sha(await readFile(f.manifest));
      await expect(verifyLanBundle(f)).rejects.toThrow(/Windows reserved device/);
    }
  });

  it('rejects symlinks instead of chasing to an external file', async () => {
    const f = await fresh();
    await rm(join(f.root,'images/agent.tar'));
    try { await symlink(f.manifest,join(f.root,'images/agent.tar')); }
    catch (err) {
      if (process.platform==='win32' && err.code==='EPERM') return;
      throw err;
    }
    await expect(verifyLanBundle(f)).rejects.toThrow(/regular single-link file/);
  });

  it('rejects hard-linked payload bytes even when digest and size match', async () => {
    const f = await fresh();
    // Same inode is writable via an out-of-bundle path, even though both
    // the preflight hash and declared payload file look legitimate.
    const outside = join(f.temp, 'external-writable-alias.tar');
    await link(join(f.root, 'images/agent.tar'), outside);
    expect(await readFile(outside, 'utf8')).toBe('verified-agent');
    await expect(verifyLanBundle(f)).rejects.toThrow(/single-link file/);
  });

  it('rejects a hard-linked manifest instead of trusting an alternate writable alias', async () => {
    const f = await fresh();
    const alias = join(f.temp, 'another-manifest-alias.json');
    await link(f.manifest, alias);
    await expect(verifyLanBundle(f)).rejects.toThrow(/single-link file/);
  });


  it('rejects ambiguous duplicate JSON keys even with a matching manifest digest', async () => {
    const f = await fresh();
    const original = await readFile(f.manifest, 'utf8');
    const ambiguous = [
      original.replace('"schema_version":1', '"schema_version":1,"schema_version":1'),
      original.replace('"files":[', '"files":[],"files":['),
      original.replace('"path":"images/agent.tar"',
        '"path":"images/agent.tar","p\\u0061th":"images/agent.tar"')
    ];
    for (const text of ambiguous) {
      await writeFile(f.manifest, text);
      f.trustedManifestSha256 = sha(text);
      await expect(verifyLanBundle(f)).rejects.toThrow('Duplicate JSON object key');
    }
  });

  it('rejects wrong mode, unexpected manifest fields and empty list', async () => {
    const f=await fresh();
    const doc=JSON.parse(await readFile(f.manifest,'utf8'));
    doc.installation_mode='public';
    await writeFile(f.manifest, JSON.stringify(doc));
    f.trustedManifestSha256=sha(await readFile(f.manifest));
    await expect(verifyLanBundle(f)).rejects.toThrow(/Unsupported LAN bundle/);
    doc.installation_mode='intranet';
    doc.unexpected = true;
    await writeFile(f.manifest, JSON.stringify(doc));
    f.trustedManifestSha256=sha(await readFile(f.manifest));
    await expect(verifyLanBundle(f)).rejects.toThrow(/unexpected fields/);
  });
});
