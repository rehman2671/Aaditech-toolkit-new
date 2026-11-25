import {it,expect} from 'vitest';
import {join,dirname} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {staged} from '../fixtures/signed-offline-oci-fixture.mjs';
import {prepareNativeOciArchive} from '../../scripts/prepare-native-oci-archive.mjs';
import {verifyNativeOciArchive} from '../../scripts/verify-native-oci-archive.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
it.skipIf(process.platform!=='linux')('independently verifies signed member bytes and rejects altered bytes even with a new archive pin',async()=>{
 await staged(async({input,g})=>{
  const destinationParent=join(dirname(dirname(input.stagedDirectory)),'native-admission');await mkdir(destinationParent,{mode:0o700});
  const r=await prepareNativeOciArchive({...input,confirmation:'PREPARE_NATIVE_OCI_ARCHIVE_ONLY',destinationParent});
  const p={...input,confirmation:'VERIFY_NATIVE_OCI_ARCHIVE_ONLY',archivePath:r.archive_path,archiveSha256:r.archive_sha256,archiveBytes:r.archive_bytes};
  const verified=await verifyNativeOciArchive(p);
  expect(verified.expected_manifest_ids).toEqual(r.expected_manifest_ids);expect(verified.expected_config_ids).toEqual(r.expected_config_ids);expect(verified.image_imported).toBe(false);
  const b=await readFile(r.archive_path);b[512]^=1;await writeFile(r.archive_path,b);
  await expect(verifyNativeOciArchive({...p,archiveSha256:sha(b)})).rejects.toThrow();
  await expect(verifyNativeOciArchive({...p,archiveBytes:p.archiveBytes+512})).rejects.toThrow();
 });
});
