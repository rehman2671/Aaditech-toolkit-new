import {describe,it,expect} from 'vitest';
import {mkdir,chmod,writeFile,readFile,link,symlink,rename,open,mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {staged} from '../fixtures/signed-offline-oci-fixture.mjs';
import {prepareOfflineDockerArchive,canonicalDockerArchiveHeader} from '../../scripts/prepare-offline-docker-archive.mjs';
import {verifyPreparedDockerArchive as verify,validateArchiveAdmissionPolicy as policy,verifyCanonicalArchiveStream as stream} from '../../scripts/verify-prepared-docker-archive.mjs';
import {parseArchiveAdmissionInput as parse} from '../../scripts/verify-prepared-docker-archive-cli.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const valid={confirmation:'VERIFY_PREPARED_DOCKER_ARCHIVE_ONLY',archivePath:'/tmp/output/stage/runtime.tar',
 archiveSha256:'a'.repeat(64),archiveBytes:4096,stagedDirectory:'/tmp/release',
 trustedManifestSha256:'b'.repeat(64),trustedSignerSpkiSha256:'c'.repeat(64),
 trustedPublicKeyPem:'-----BEGIN PUBLIC KEY-----\nfixture',architecture:'amd64'};
describe('strict admission policy',()=>{
 it('snapshots the exact input',()=>{const p={...valid};const r=policy(p);p.archiveBytes=0;expect(r.archiveBytes).toBe(4096);expect(Object.isFrozen(r)).toBe(true)});
 for(const k of Object.keys(valid))it('refuses missing '+k,()=>{const p={...valid};delete p[k];expect(()=>policy(p)).toThrow()});
 for(const [k,bads] of [
 ['confirmation',['LOAD',null]],['archivePath',['runtime.tar','/tmp/x/../runtime.tar','/tmp/output/a.tar','/tmp/release/runtime.tar','/tmp/output/\n/runtime.tar']],
 ['archiveSha256',['0'.repeat(64),'A'.repeat(64),'a'.repeat(64)+'\n',null]],
 ['archiveBytes',[0,511,1025,1.5,'4096',34*1024**3]],
 ['stagedDirectory',['relative','/tmp/output/stage/nested','/tmp/release/','/tmp/\0']],
 ['trustedManifestSha256',['0'.repeat(64),null]],['trustedSignerSpkiSha256',['0'.repeat(64),null]],
 ['trustedPublicKeyPem',['-----BEGIN PRIVATE KEY-----\nfixture','x'.repeat(8193),null]],['architecture',['386','AMD64',null]]
 ])for(const bad of bads)it('refuses '+k+' '+JSON.stringify(bad)?.slice(0,90),()=>expect(()=>policy({...valid,[k]:bad})).toThrow());
 it('refuses unknown field',()=>expect(()=>policy({...valid,execute:true})).toThrow());
 it('refuses accessor without calling it',()=>{const p={...valid};Object.defineProperty(p,'archiveBytes',{enumerable:true,get(){throw Error('getter executed')}});expect(()=>policy(p)).toThrow('OFFLINE_DOCKER_ARCHIVE_ADMISSION_UNVERIFIED')});
 it('refuses symbol field',()=>expect(()=>policy({...valid,[Symbol('extra')]:1})).toThrow());
});
describe('strict admission CLI',()=>{
 const doc={...valid};delete doc.confirmation;const b=Buffer.from(JSON.stringify(doc)),args=['--verify-prepared-docker-archive'];
 it('accepts exact bounded input',()=>expect(parse(b,args)).toEqual(valid));
 for(const [name,bytes,argv] of [
 ['empty',Buffer.alloc(0),args],['oversize',Buffer.alloc(32769),args],['invalid UTF8',Buffer.from([255]),args],
 ['missing flag',b,[]],['wrong flag',b,['--load']],['extra flag',b,[...args,'--force']],
 ['duplicate',Buffer.from(JSON.stringify(doc).replace('"architecture":','"architecture":"arm64","architecture":')),args],
 ['extra',Buffer.from(JSON.stringify({...doc,confirmation:valid.confirmation})),args],
 ['array',Buffer.from('[]'),args],['null',Buffer.from('null'),args]
 ])it('refuses '+name,()=>expect(()=>parse(bytes,argv)).toThrow());
});
function mini(){
 const c=Buffer.from('config'),l=Buffer.alloc(1024,65),m=Buffer.from('manifest');
 const configs=new Map([['config-test.json',{size:c.length,digest:sha(c)}]]);
 const layers=new Map([['layer-test.tar',{uncompressed_bytes:l.length,diff_id:'sha256:'+sha(l)}]]);
 const member=(n,b)=>Buffer.concat([canonicalDockerArchiveHeader(n,b.length),b,Buffer.alloc((512-b.length%512)%512)]);
 const bytes=Buffer.concat([member('config-test.json',c),member('layer-test.tar',l),member('manifest.json',m),Buffer.alloc(1024)]);
 return {bytes,plan:{configs,layers,manifestBytes:m,archiveBytes:bytes.length}};
}
async function withFile(bytes,fn){
 const dir=await mkdtemp(join(await realpath(tmpdir()),'docker-stream-'));
 try{const path=join(dir,'file');await writeFile(path,bytes);const fd=await open(path,'r');try{return await fn(fd)}finally{await fd.close()}}
 finally{await rm(dir,{recursive:true,force:true})}
}
describe('canonical stream independent member admission',()=>{
 it('admits exact ordered bytes',()=>{const {bytes,plan}=mini();return withFile(bytes,async fd=>expect(await stream(fd,plan,sha(bytes))).toBe(true))});
 for(const offset of [0,100,124,148,156,257,511,512,518,1024,1536,2047,2559,2560,3072,3080,3584,4095,4607]){
  it('rejects modified byte even with recomputed outer hash at '+offset,async()=>{const {bytes,plan}=mini();expect(offset).toBeLessThan(bytes.length);bytes[offset]^=1;await withFile(bytes,fd=>expect(stream(fd,plan,sha(bytes))).rejects.toThrow())});
 }
 for(const size of [1,511,512,1024,2048])it('rejects truncation by '+size,async()=>{const {bytes,plan}=mini();const b=bytes.subarray(0,bytes.length-size);await withFile(b,fd=>expect(stream(fd,plan,sha(b))).rejects.toThrow())});
 it('rejects appended zero block',async()=>{const {bytes,plan}=mini();const b=Buffer.concat([bytes,Buffer.alloc(512)]);await withFile(b,fd=>expect(stream(fd,plan,sha(bytes))).rejects.toThrow())});
 it('rejects wrong outer hash after payload validation',async()=>{const {bytes,plan}=mini();await withFile(bytes,fd=>expect(stream(fd,plan,'f'.repeat(64))).rejects.toThrow())});
});
async function fixture(fn){return staged(async({input,g})=>{
 const destinationParent=join(dirname(dirname(input.stagedDirectory)),'archive-output');
 await mkdir(destinationParent,{mode:0o700});await chmod(destinationParent,0o700);
 const r=await prepareOfflineDockerArchive({...input,confirmation:'PREPARE_UNTAGGED_OFFLINE_DOCKER_ARCHIVE_ONLY',destinationParent});
 const p={...input,confirmation:valid.confirmation,archivePath:r.archive_path,archiveSha256:r.archive_sha256,archiveBytes:r.archive_bytes};
 await fn(p,r,g,destinationParent);
})}
describe.skipIf(process.platform!=='linux')('real signed archive admission',()=>{
 it('verifies prepared archive without import',()=>fixture(async(p,r)=>{const result=await verify(p);expect(result.expected_image_ids).toEqual(r.expected_image_ids);expect(result).toMatchObject({archive_bytes_verified:true,ordered_layer_diff_ids_verified:true,image_imported:false,installation_authorized:false,production_accepted:false});expect(JSON.stringify(result)).not.toContain(p.archivePath)}));
 for(const [name,mutate] of [
 ['wrong archive pin',async p=>({...p,archiveSha256:'f'.repeat(64)})],
 ['wrong archive size',async p=>({...p,archiveBytes:p.archiveBytes+512})],
 ['wrong signer',async p=>({...p,trustedSignerSpkiSha256:'f'.repeat(64)})],
 ['wrong release',async p=>({...p,trustedManifestSha256:'f'.repeat(64)})],
 ['wrong architecture',async p=>({...p,architecture:'arm64'})],
 ['file mode',async p=>{await chmod(p.archivePath,0o644);return p}],
 ['stage mode',async p=>{await chmod(dirname(p.archivePath),0o755);return p}],
 ['hard link',async p=>{await link(p.archivePath,p.archivePath+'.link');return p}],
 ['symlink',async p=>{await rename(p.archivePath,p.archivePath+'.real');await symlink(p.archivePath+'.real',p.archivePath);return p}],
 ['tampered content repinned',async p=>{const b=await readFile(p.archivePath);b[512]^=1;await writeFile(p.archivePath,b);return {...p,archiveSha256:sha(b)}}]
 ])it('refuses '+name,()=>fixture(async p=>{await expect(verify(await mutate(p))).rejects.toThrow()}));
 it('actual CLI emits only safe receipt',()=>fixture(async p=>{const doc={...p};delete doc.confirmation;const script=fileURLToPath(new URL('../../scripts/verify-prepared-docker-archive-cli.mjs',import.meta.url));const r=spawnSync(process.execPath,[script,'--verify-prepared-docker-archive'],{input:JSON.stringify(doc),encoding:'utf8',timeout:15000});expect(r.status).toBe(0);expect(r.stderr).toBe('');expect(JSON.parse(r.stdout).archive_bytes_verified).toBe(true)}));
});
