import {it,expect} from 'vitest';
import {join,dirname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {staged} from '../fixtures/signed-offline-oci-fixture.mjs';
import {prepareNativeOciFixtureArchive} from '../fixtures/native-oci-fixture-archive.mjs';
it.skipIf(process.platform!=='linux')('native fixture preserves signed manifest identities and every OCI byte',async()=>{
 await staged(async({input,g})=>{
  const path=join(dirname(dirname(input.stagedDirectory)),'native.tar');
  const receipt=await prepareNativeOciFixtureArchive(input,g,path);
  expect(Object.values(receipt.expected_image_ids)).toEqual(g.index.manifests.map(x=>x.digest));
  const b=await readFile(path),found=new Map();let at=0;
  while(b[at]!==0){const header=b.subarray(at,at+512),name=header.subarray(0,100).toString().split('\0')[0],size=parseInt(header.subarray(124,136).toString(),8);at+=512;found.set('runtime/'+name,b.subarray(at,at+size));at+=Math.ceil(size/512)*512}
  expect(found.size).toBe(g.files.size);for(const [name,bytes] of g.files)expect(found.get(name)).toEqual(bytes);
  expect(b.subarray(at)).toEqual(Buffer.alloc(1024));
 });
});
