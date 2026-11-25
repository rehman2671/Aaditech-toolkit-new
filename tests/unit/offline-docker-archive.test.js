import {describe,it,expect} from 'vitest';
import {mkdir,readFile,readdir,chmod,lstat,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {staged} from '../fixtures/signed-offline-oci-fixture.mjs';
import {prepareOfflineDockerArchive as prepare,planDockerArchive as plan} from '../../scripts/prepare-offline-docker-archive.mjs';
import {parseArchivePreparationInput as parse} from '../../scripts/prepare-offline-docker-archive-cli.mjs';
const id=c=>'sha256:'+c.repeat(64),roles=['api','database','ingress'];
const policy={confirmation:'PREPARE_UNTAGGED_OFFLINE_DOCKER_ARCHIVE_ONLY',architecture:'amd64',stagedDirectory:'/tmp/release-abcdef',destinationParent:'/tmp/output',trustedManifestSha256:'a'.repeat(64),trustedSignerSpkiSha256:'b'.repeat(64),trustedPublicKeyPem:'-----BEGIN PUBLIC KEY-----\nfixture'};
const release={images:roles.map((role,i)=>({role,image_config_id:id('abc'[i]),config_bytes:150,layers:[{blob_sha256:'d'.repeat(64),diff_id:id('e'),compressed_bytes:100,uncompressed_bytes:2048}]}))};
describe('untagged Docker archive plan',()=>{
 it('deduplicates shared members and preserves untagged ordered layer references',()=>{
  const r=plan(release),m=JSON.parse(r.manifestBytes);expect(r.configs.size).toBe(3);expect(r.layers.size).toBe(1);
  expect(m).toHaveLength(3);expect(m.every(x=>x.RepoTags.length===0&&x.Layers.length===1)).toBe(true);expect(r.archiveBytes%512).toBe(0);
 });
 for(const [label,mutate] of [
 ['missing role',x=>x.images.pop()],['unknown role',x=>x.images[0].role='worker'],['duplicate role',x=>x.images[1].role='api'],
 ['duplicate config',x=>x.images[1].image_config_id=x.images[0].image_config_id],
 ['shared blob wrong diff',x=>x.images[1].layers[0].diff_id=id('f')],['shared blob wrong size',x=>x.images[1].layers[0].compressed_bytes++],
 ['shared blob wrong unpacked size',x=>x.images[1].layers[0].uncompressed_bytes++],['empty layers',x=>x.images[0].layers=[]],
 ['too many layers',x=>x.images[0].layers=Array(129).fill(x.images[0].layers[0])],
 ['oversize archive',x=>{for(let i=0;i<3;i++)x.images[i].layers=Array.from({length:2},(_,n)=>({...x.images[i].layers[0],blob_sha256:String(i*2+n+1).repeat(64),uncompressed_bytes:8*1024**3}))}]
 ])it('refuses '+label,()=>{const x=structuredClone(release);mutate(x);expect(()=>plan(x)).toThrow()});
 for(const [key,bads] of [['image_config_id',['latest',id('0'),id('A'),null,id('a')+'\n']],['config_bytes',[0,-1,1.5,1024*1024+1,'150']]])
 for(const bad of bads)it('refuses '+key+' '+JSON.stringify(bad),()=>{const x=structuredClone(release);x.images[0][key]=bad;expect(()=>plan(x)).toThrow()});
 for(const [key,bads] of [['blob_sha256',['../file','0'.repeat(64),'A'.repeat(64),null]],['diff_id',['latest',id('0'),id('A'),null]],['compressed_bytes',[0,-1,1.5,64*1024**3+1,'100']],['uncompressed_bytes',[0,-1,1.5,8*1024**3+1,'2048']]])
 for(const bad of bads)it('refuses layer '+key+' '+JSON.stringify(bad),()=>{const x=structuredClone(release);x.images[0].layers[0][key]=bad;expect(()=>plan(x)).toThrow()});
});
describe('strict archive CLI',()=>{
 const doc={...policy};delete doc.confirmation;const b=Buffer.from(JSON.stringify(doc)),args=['--prepare-untagged-offline-archive'];
 it('accepts exact policy',()=>expect(parse(b,args)).toEqual(policy));
 for(const [label,bytes,argv] of [
 ['missing flag',b,[]],['wrong flag',b,['--load']],['extra flag',b,[...args,'--force']],['empty',Buffer.alloc(0),args],
 ['oversize',Buffer.alloc(32769),args],['invalid UTF8',Buffer.from([255]),args],
 ['duplicate',Buffer.from(JSON.stringify(doc).replace('"architecture":','"architecture":"arm64","architecture":')),args],
 ['extra field',Buffer.from(JSON.stringify({...doc,execute:true})),args],
 ['relative output',Buffer.from(JSON.stringify({...doc,destinationParent:'relative'})),args],
 ['relative source',Buffer.from(JSON.stringify({...doc,stagedDirectory:'relative'})),args],
 ['wrong arch',Buffer.from(JSON.stringify({...doc,architecture:'386'})),args],
 ['zero pin',Buffer.from(JSON.stringify({...doc,trustedManifestSha256:'0'.repeat(64)})),args]
 ])it('refuses '+label,()=>expect(()=>parse(bytes,argv)).toThrow());
});
async function fixture(fn){return staged(async({input,g})=>{
 const destinationParent=join(dirname(dirname(input.stagedDirectory)),'archive-output');await mkdir(destinationParent,{mode:0o700});await chmod(destinationParent,0o700);
 await fn({g,destinationParent,input:{...input,confirmation:policy.confirmation,destinationParent}});
})}
function unpack(b){const m=new Map();let p=0;while(p+512<=b.length){const h=b.subarray(p,p+512);p+=512;if(h.every(x=>x===0))break;const name=h.subarray(0,100).toString().split('\0')[0],size=parseInt(h.subarray(124,136).toString(),8);m.set(name,b.subarray(p,p+size));p+=Math.ceil(size/512)*512}return m}
describe.skipIf(process.platform!=='linux')('real signed archive preparation',()=>{
 it('writes private archive preserving exact image and layer identities',()=>fixture(async({g,input,destinationParent})=>{
  const r=await prepare(input),b=await readFile(r.archive_path),m=unpack(b),manifest=JSON.parse(m.get('manifest.json'));
  expect(r.archive_sha256).toBe(createHash('sha256').update(b).digest('hex'));expect(r.archive_bytes).toBe(b.length);
  expect(r).toMatchObject({untagged_archive_prepared:true,image_imported:false,installation_authorized:false,production_accepted:false});
  expect((await lstat(r.archive_path)).mode&0o7777).toBe(0o600);expect((await lstat(dirname(r.archive_path))).mode&0o7777).toBe(0o700);expect(await readdir(destinationParent)).toHaveLength(1);expect(m.size).toBe(5);
  for(let i=0;i<3;i++){const row=manifest[i];expect(row.RepoTags).toEqual([]);expect('sha256:'+createHash('sha256').update(m.get(row.Config)).digest('hex')).toBe(g.manifests[i].config.digest);expect('sha256:'+createHash('sha256').update(m.get(row.Layers[0])).digest('hex')).toBe(g.configs[i].rootfs.diff_ids[0])}
 }));
 it('prepares unique concurrent copies',()=>fixture(async({input,destinationParent})=>{const r=await Promise.all([prepare(input),prepare(input)]);expect(r[0].archive_path).not.toBe(r[1].archive_path);expect(r[0].archive_sha256).toBe(r[1].archive_sha256);expect(await readdir(destinationParent)).toHaveLength(2)}));
 for(const [label,mutate] of [
 ['wrong confirmation',async x=>({...x.input,confirmation:'load'})],['wrong release pin',async x=>({...x.input,trustedManifestSha256:'a'.repeat(64)})],
 ['wrong signer',async x=>({...x.input,trustedSignerSpkiSha256:'b'.repeat(64)})],['wrong architecture',async x=>({...x.input,architecture:'arm64'})],
 ['unsafe output mode',async x=>{await chmod(x.destinationParent,0o755);return x.input}],['overlapping output',async x=>({...x.input,destinationParent:x.input.stagedDirectory})],
 ['symlink output',async x=>{const alias=x.destinationParent+'-alias';await symlink(x.destinationParent,alias);return {...x.input,destinationParent:alias}}]
 ])it('refuses '+label,()=>fixture(async x=>{await expect(prepare(await mutate(x))).rejects.toThrow();expect(await readdir(x.destinationParent)).toEqual([])}));
 it('prepares archive via actual CLI',()=>fixture(async({input})=>{const doc={...input};delete doc.confirmation;const script=fileURLToPath(new URL('../../scripts/prepare-offline-docker-archive-cli.mjs',import.meta.url));const r=spawnSync(process.execPath,[script,'--prepare-untagged-offline-archive'],{input:JSON.stringify(doc),encoding:'utf8',timeout:15000});expect(r.status).toBe(0);expect(r.stderr).toBe('');expect(JSON.parse(r.stdout).image_imported).toBe(false)}));
});
