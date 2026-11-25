import {describe,it,expect} from 'vitest';
import {mkdir,chmod,readFile,writeFile,link,symlink,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {staged} from '../fixtures/signed-offline-oci-fixture.mjs';
import {prepareOfflineDockerArchive} from '../../scripts/prepare-offline-docker-archive.mjs';
import {validateArchiveReadbackInput as validate,verifyPreparedDockerArchive as verify} from '../../scripts/verify-prepared-docker-archive.mjs';
import {parseArchiveReadbackInput as parse} from '../../scripts/verify-prepared-docker-archive-cli.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const policy={confirmation:'VERIFY_PREPARED_DOCKER_ARCHIVE_ONLY',architecture:'amd64',archivePath:'/tmp/output/runtime.tar',stagedDirectory:'/tmp/source/release',expectedArchiveSha256:'c'.repeat(64),trustedManifestSha256:'a'.repeat(64),trustedSignerSpkiSha256:'b'.repeat(64),trustedPublicKeyPem:'-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n'};
describe('strict readback policy',()=>{
 it('freezes exact policy snapshot',()=>expect(Object.isFrozen(validate(policy))).toBe(true));
 for(const [key,bads] of [
 ['confirmation',['load','',null]],['architecture',['386','windows',null]],
 ['archivePath',['relative','/tmp/output/../output/runtime.tar','/tmp/output/file.tar','/tmp/source/release/runtime.tar','/tmp/runtime.tar','/tmp/output/runtime.tar\n',null]],
 ['stagedDirectory',['relative','/tmp/source/../source/release','/tmp/output','/tmp/output/sub','/tmp/source/release\0',null]],
 ['expectedArchiveSha256',['0'.repeat(64),'A'.repeat(64),'a'.repeat(63),'a'.repeat(64)+'\n',null]],
 ['trustedManifestSha256',['0'.repeat(64),'short',null]],['trustedSignerSpkiSha256',['0'.repeat(64),'short',null]],
 ['trustedPublicKeyPem',['private','-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n\n',policy.trustedPublicKeyPem+policy.trustedPublicKeyPem,null]]
 ])for(const bad of bads)it('rejects '+key+' '+JSON.stringify(bad),()=>expect(()=>validate({...policy,[key]:bad})).toThrow());
 it('rejects unknown field',()=>expect(()=>validate({...policy,force:true})).toThrow());
 it('rejects inherited policy',()=>expect(()=>validate(Object.create(policy))).toThrow());
 it('rejects accessor without invoking it',()=>{let reads=0;const p={...policy};Object.defineProperty(p,'archivePath',{enumerable:true,get(){reads++;return policy.archivePath}});expect(()=>validate(p)).toThrow();expect(reads).toBe(0)});
});
describe('bounded operator CLI',()=>{
 const doc={...policy};delete doc.confirmation;const bytes=Buffer.from(JSON.stringify(doc)),args=['--verify-prepared-archive'];
 it('accepts exact JSON',()=>expect(parse(bytes,args)).toEqual(policy));
 for(const [label,b,a] of [
 ['missing option',bytes,[]],['import option',bytes,['--load']],['extra option',bytes,[...args,'--force']],
 ['oversize',Buffer.alloc(32769),args],['invalid UTF8',Buffer.from([255]),args],
 ['duplicate key',Buffer.from(JSON.stringify(doc).replace('"architecture":','"architecture":"arm64","architecture":')),args],
 ['explicit confirmation',Buffer.from(JSON.stringify(policy)),args],['empty',Buffer.alloc(0),args]
 ])it('rejects '+label,()=>expect(()=>parse(b,a)).toThrow('ARCHIVE_READBACK_INPUT_INVALID'));
});
async function fixture(fn){return staged(async({input})=>{
 const destinationParent=join(dirname(dirname(input.stagedDirectory)),'archive-output');await mkdir(destinationParent,{mode:0o700});await chmod(destinationParent,0o700);
 const receipt=await prepareOfflineDockerArchive({...input,confirmation:'PREPARE_UNTAGGED_OFFLINE_DOCKER_ARCHIVE_ONLY',destinationParent});
 const p={...input,confirmation:policy.confirmation,archivePath:receipt.archive_path,expectedArchiveSha256:receipt.archive_sha256};
 await fn(p,receipt);
})}
describe.skipIf(process.platform!=='linux')('exact private archive readback',()=>{
 it('verifies prepared bytes and signed source without import',()=>fixture(async(p,r)=>{
  expect(await verify(p)).toMatchObject({archive_readback_verified:true,signed_source_binding_verified:true,cross_layer_path_profile_verified:true,expected_image_ids:r.expected_image_ids,image_imported:false,production_accepted:false});
 }));
 it('rejects independent digest mismatch',()=>fixture(async p=>{await expect(verify({...p,expectedArchiveSha256:'d'.repeat(64)})).rejects.toThrow()}));
 for(const [label,index] of [['header',0],['config content',512],['end record',-1],['second end record',-513]])
 it('rejects '+label+' tampering even with replacement archive digest',()=>fixture(async p=>{
  const b=await readFile(p.archivePath);b[index<0?b.length+index:index]^=1;await writeFile(p.archivePath,b);
  await expect(verify({...p,expectedArchiveSha256:sha(b)})).rejects.toThrow();
 }));
 it('rejects group-readable file',()=>fixture(async p=>{await chmod(p.archivePath,0o640);await expect(verify(p)).rejects.toThrow()}));
 it('rejects hardlinked file',()=>fixture(async p=>{await link(p.archivePath,p.archivePath+'.alias');await expect(verify(p)).rejects.toThrow()}));
 it('rejects symlink file',()=>fixture(async p=>{await rename(p.archivePath,p.archivePath+'.real');await symlink(p.archivePath+'.real',p.archivePath);await expect(verify(p)).rejects.toThrow()}));
 it('rejects wrong signed release pin',()=>fixture(async p=>{await expect(verify({...p,trustedManifestSha256:'d'.repeat(64)})).rejects.toThrow()}));
 it('verifies via real CLI',()=>fixture(async p=>{
  const doc={...p};delete doc.confirmation;const script=fileURLToPath(new URL('../../scripts/verify-prepared-docker-archive-cli.mjs',import.meta.url));
  const r=spawnSync(process.execPath,[script,'--verify-prepared-archive'],{input:JSON.stringify(doc),encoding:'utf8',timeout:15000});
  expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({archive_readback_verified:true,image_imported:false});
 }));
});
