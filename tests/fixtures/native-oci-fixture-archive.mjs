// Synthetic signed OCI fixture only. Native OCI layout preserves publisher
// manifest digests instead of synthesizing manifests from legacy Docker tar.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectOfflineOciRuntime} from '../../scripts/inspect-offline-oci-runtime.mjs';
import {canonicalDockerArchiveHeader} from '../../scripts/prepare-offline-docker-archive.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('NATIVE_OCI_FIXTURE_UNVERIFIED')};
export async function prepareNativeOciFixtureArchive(input,g,output){
 const release=await inspectOfflineOciRuntime(input);
 if(!release.release_signature_verified||!release.strict_ustar_profile_verified||!release.cross_layer_path_profile_verified||g.entries.length>32)fail();
 const chunks=[];let total=0;
 for(const e of [...g.entries].sort((a,b)=>a.path.localeCompare(b.path))){
  if(!/^runtime\/(?:index\.json|oci-layout|blobs\/sha256\/[a-f0-9]{64})$/.test(e.path)||e.size>1048576)fail();
  const name=e.path.slice(8),bytes=await readFile(join(input.stagedDirectory,'payload',e.path));
  if(bytes.length!==e.size||sha(bytes)!==e.sha256)fail();
  // All names fit USTAR name field. Existing header helper accepts simple
  // names only; replace its name field and recompute the checksum.
  const h=canonicalDockerArchiveHeader('fixture',bytes.length);
  h.fill(0,0,100);h.write(name,0,'ascii');h.fill(32,148,156);
  h.write(h.reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148,'ascii');
  chunks.push(h,bytes,Buffer.alloc((512-bytes.length%512)%512));total+=512+bytes.length+(512-bytes.length%512)%512;
  if(total>8*1024*1024)fail();
 }
 chunks.push(Buffer.alloc(1024));
 const final=await inspectOfflineOciRuntime(input);if(JSON.stringify(final)!==JSON.stringify(release))fail();
 await writeFile(output,Buffer.concat(chunks),{flag:'wx',mode:0o600});
 return {archive_path:output,expected_image_ids:Object.fromEntries(release.images.map(x=>[x.role,x.manifest_digest])),images:release.images};
}
