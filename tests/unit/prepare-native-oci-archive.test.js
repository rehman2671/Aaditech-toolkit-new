import {it,expect} from 'vitest';
import {join,dirname} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {staged} from '../fixtures/signed-offline-oci-fixture.mjs';
import {prepareNativeOciArchive} from '../../scripts/prepare-native-oci-archive.mjs';
it.skipIf(process.platform!=='linux')('prepares native OCI archive from pinned signed stage, preserving original members and digests',async()=>{
 await staged(async({input,g})=>{
  const destinationParent=join(dirname(dirname(input.stagedDirectory)),'native-output');await mkdir(destinationParent,{mode:0o700});
  const args={...input,confirmation:'PREPARE_NATIVE_OCI_ARCHIVE_ONLY',destinationParent};
  const r=await prepareNativeOciArchive(args);
  expect(r.expected_manifest_ids).toEqual(Object.fromEntries(g.index.manifests.map(x=>[x.annotations['org.aaditech.role'],x.digest])));
  expect(r.image_imported).toBe(false);
  const b=await readFile(r.archive_path);expect(createHash('sha256').update(b).digest('hex')).toBe(r.archive_sha256);expect(b.length).toBe(r.archive_bytes);
  let at=0;const members=new Map();while(b[at]!==0){const h=b.subarray(at,at+512),name=h.subarray(0,100).toString().split('\0')[0],size=parseInt(h.subarray(124,136).toString(),8);at+=512;members.set('runtime/'+name,b.subarray(at,at+size));at+=Math.ceil(size/512)*512}
  expect(members.size).toBe(g.files.size);for(const [name,bytes] of g.files)expect(members.get(name)).toEqual(bytes);
  await expect(prepareNativeOciArchive({...args,trustedManifestSha256:'f'.repeat(64)})).rejects.toThrow();
  await expect(prepareNativeOciArchive({...args,destinationParent:input.stagedDirectory})).rejects.toThrow();
 });
});
