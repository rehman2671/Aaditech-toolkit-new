import {describe,it,expect} from 'vitest';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdtemp,mkdir,chmod,writeFile,rm,realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {verifyOfflineOciGraph,inspectOfflineOciRuntime,verifyGzipLayerFile} from '../../scripts/inspect-offline-oci-runtime.mjs';
import {stageOfflineLanBundle} from '../../scripts/stage-offline-lan-bundle.mjs';
import {parseOfflineOciInput} from '../../scripts/inspect-offline-oci-runtime-cli.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),id=c=>'sha256:'+c.repeat(64);
const types={index:'application/vnd.oci.image.index.v1+json',manifest:'application/vnd.oci.image.manifest.v1+json',config:'application/vnd.oci.image.config.v1+json',layer:'application/vnd.oci.image.layer.v1.tar+gzip'};
const roles=['api','database','ingress'];
function graph(architecture='amd64',layerOverride=null){
 const files=new Map(),docs=new Map(),configs=[],manifests=[];
 function put(path,doc){const bytes=Buffer.from(JSON.stringify(doc));files.set(path,bytes);docs.set(path,doc)}
 function blob(bytes,type){const digest='sha256:'+sha(bytes),path='runtime/blobs/sha256/'+digest.slice(7);files.set(path,bytes);return {mediaType:type,digest,size:bytes.length}}
 function jsonBlob(doc,type){const d=blob(Buffer.from(JSON.stringify(doc)),type);docs.set('runtime/blobs/sha256/'+d.digest.slice(7),doc);return d}
 const h=Buffer.alloc(512);h.write('fixture.txt',0,'ascii');h.write('0000644\0',100,'ascii');h.write('0000000\0',108,'ascii');h.write('0000000\0',116,'ascii');h.write('00000000001\0',124,'ascii');h.write('00000000000\0',136,'ascii');h.fill(32,148,156);h[156]=48;h.write('ustar\0',257,'ascii');h.write('00',263,'ascii');h.write(h.reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148,'ascii');
 const data=Buffer.alloc(512);data[0]=65;
 const layerBytes=layerOverride??Buffer.concat([h,data,Buffer.alloc(1024)]),layer=blob(gzipSync(layerBytes),types.layer);
 const index={schemaVersion:2,mediaType:types.index,manifests:[]};
 for(const role of roles){
  const config={architecture,os:'linux',config:{Env:['SECRET=fixture'],Labels:{role}},rootfs:{type:'layers',diff_ids:['sha256:'+sha(layerBytes)]}};
  const c=jsonBlob(config,types.config),manifest={schemaVersion:2,mediaType:types.manifest,config:c,layers:[{...layer}]};
  const m=jsonBlob(manifest,types.manifest);configs.push(config);manifests.push(manifest);
  index.manifests.push({...m,platform:{architecture,os:'linux'},annotations:{'org.aaditech.role':role}});
 }
 const layout={imageLayoutVersion:'1.0.0'};put('runtime/oci-layout',layout);put('runtime/index.json',index);
 const entries=[...files].map(([path,b])=>({path,size:b.length,sha256:sha(b)}));
 const input={architecture,entries,readMetadata:async path=>docs.get(path)};
 return {files,docs,configs,manifests,index,layout,entries,input};
}
describe('strict signed OCI descriptor graph profile',()=>{
 for(const architecture of ['amd64','arm64'])it('maps all three '+architecture+' role config IDs and shared layers',async()=>{
  const g=graph(architecture),r=await verifyOfflineOciGraph(g.input);
  expect(r.map(x=>x.role)).toEqual(roles);
  expect(r.map(x=>x.image_config_id)).toEqual(g.manifests.map(x=>x.config.digest));
  expect(r.every(x=>x.layer_count===1)).toBe(true);
  expect(JSON.stringify(r)).not.toContain('SECRET');
 });
 for(const [label,change] of [
  ['unsupported layout',g=>g.layout.imageLayoutVersion='2.0.0'],
  ['layout extra field',g=>g.layout.extra=true],
  ['index version',g=>g.index.schemaVersion=1],
  ['index media',g=>g.index.mediaType='wrong'],
  ['index missing role',g=>g.index.manifests.pop()],
  ['index extra role',g=>g.index.manifests.push(g.index.manifests[0])],
  ['index extra field',g=>g.index.urls=['https://example.invalid']],
  ['duplicate role',g=>g.index.manifests[1].annotations['org.aaditech.role']='api'],
  ['unknown role',g=>g.index.manifests[0].annotations['org.aaditech.role']='worker'],
  ['extra annotation',g=>g.index.manifests[0].annotations.tag='latest'],
  ['wrong platform OS',g=>g.index.manifests[0].platform.os='windows'],
  ['wrong platform arch',g=>g.index.manifests[0].platform.architecture='arm64'],
  ['platform variant',g=>g.index.manifests[0].platform.variant='v8'],
  ['index descriptor URLs',g=>g.index.manifests[0].urls=['https://example.invalid']],
  ['manifest missing blob',g=>g.index.manifests[0].digest=id('d')],
  ['manifest wrong size',g=>g.index.manifests[0].size++],
  ['manifest duplicate digest',g=>{const a=g.index.manifests[0],b=g.index.manifests[1];b.digest=a.digest;b.size=a.size}],
  ['manifest version',g=>g.manifests[0].schemaVersion=1],
  ['manifest media',g=>g.manifests[0].mediaType='wrong'],
  ['manifest extra field',g=>g.manifests[0].subject={}],
  ['no layers',g=>g.manifests[0].layers=[]],
  ['too many layers',g=>g.manifests[0].layers=Array(129).fill(g.manifests[0].layers[0])],
  ['config external URL',g=>g.manifests[0].config.urls=['https://example.invalid']],
  ['config wrong media',g=>g.manifests[0].config.mediaType='wrong'],
  ['config missing blob',g=>g.manifests[0].config.digest=id('d')],
  ['config wrong size',g=>g.manifests[0].config.size++],
  ['duplicate config',g=>g.manifests[1].config=g.manifests[0].config],
  ['config wrong OS',g=>g.configs[0].os='windows'],
  ['config wrong arch',g=>g.configs[0].architecture='arm64'],
  ['rootfs type',g=>g.configs[0].rootfs.type='other'],
  ['rootfs extra field',g=>g.configs[0].rootfs.extra=true],
  ['diff count',g=>g.configs[0].rootfs.diff_ids=[]],
  ['diff digest',g=>g.configs[0].rootfs.diff_ids=[id('0')]],
  ['layer external URL',g=>g.manifests[0].layers[0].urls=['https://example.invalid']],
  ['layer wrong media',g=>g.manifests[0].layers[0].mediaType='application/vnd.oci.image.layer.v1.tar'],
  ['layer missing blob',g=>g.manifests[0].layers[0].digest=id('d')],
  ['layer wrong size',g=>g.manifests[0].layers[0].size++],
  ['layer zero digest',g=>g.manifests[0].layers[0].digest=id('0')],
  ['layer negative size',g=>g.manifests[0].layers[0].size=-1],
  ['layer huge size',g=>g.manifests[0].layers[0].size=64*1024**3+1],
  ['layer embedded data',g=>g.manifests[0].layers[0].data='AA=='],
  ['duplicate file entry',g=>g.entries.push(g.entries[0])],
  ['uppercase file digest',g=>g.entries[0].sha256='A'.repeat(64)],
  ['unreferenced runtime file',g=>g.entries.push({path:'runtime/extra',size:1,sha256:'a'.repeat(64)})],
  ['missing index',g=>g.entries.splice(g.entries.findIndex(e=>e.path==='runtime/index.json'),1)],
  ['missing layout',g=>g.entries.splice(g.entries.findIndex(e=>e.path==='runtime/oci-layout'),1)]
 ])it('refuses '+label,async()=>{const g=graph();change(g);await expect(verifyOfflineOciGraph(g.input)).rejects.toThrow('OFFLINE_OCI_RUNTIME_UNVERIFIED')});
 for(const bad of ['latest','sha256:abcd',id('A'),id('a')+'\n',null,42])
  it('rejects descriptor digest '+JSON.stringify(bad),async()=>{const g=graph();g.index.manifests[0].digest=bad;await expect(verifyOfflineOciGraph(g.input)).rejects.toThrow()});
});
async function staged(fn,layerOverride=null){
 const dir=await mkdtemp(join(await realpath(tmpdir()),'oci-lan-'));
 try{
  const g=graph('amd64',layerOverride),root=join(dir,'source'),destinationParent=join(dir,'dest');
  await mkdir(root);await mkdir(destinationParent,{mode:0o700});await chmod(destinationParent,0o700);
  for(const [name,bytes] of g.files){const path=join(root,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes)}
  const manifest=join(dir,'manifest.json'),signature=join(dir,'manifest.sig'),key=generateKeyPairSync('ed25519');
  const bytes=Buffer.from(JSON.stringify({schema_version:1,installation_mode:'intranet',files:g.entries}));
  await writeFile(manifest,bytes);await writeFile(signature,sign(null,bytes,key.privateKey));
  const bundle={root,manifest,signature,trustedManifestSha256:sha(bytes),trustedPublicKeyPem:key.publicKey.export({type:'spki',format:'pem'}),trustedSignerSpkiSha256:sha(key.publicKey.export({type:'spki',format:'der'}))};
  const stage=await stageOfflineLanBundle({confirmation:'STAGE_VERIFIED_OFFLINE_BUNDLE_ONLY',bundle,destinationParent});
  const input={confirmation:'INSPECT_SIGNED_OCI_RUNTIME_ONLY',stagedDirectory:stage.staged_directory,architecture:'amd64',trustedManifestSha256:bundle.trustedManifestSha256,trustedPublicKeyPem:bundle.trustedPublicKeyPem,trustedSignerSpkiSha256:bundle.trustedSignerSpkiSha256};
  await fn({g,input});
 }finally{await rm(dir,{recursive:true,force:true})}
}
describe.skipIf(process.platform!=='linux')('real signed staged OCI release',()=>{
 it('verifies actual signed bytes and descriptor graph without import or execution',()=>staged(async({g,input})=>{
  const r=await inspectOfflineOciRuntime(input);
  expect(r.images.map(x=>x.image_config_id)).toEqual(g.manifests.map(x=>x.config.digest));
  expect(r).toMatchObject({release_signature_verified:true,compressed_blob_integrity_verified:true,oci_descriptor_graph_verified:true,uncompressed_diff_ids_verified:true,strict_ustar_profile_verified:true,merged_rootfs_verified:false,image_imported:false,installation_authorized:false,production_accepted:false});
 }));
 it('inspects signed staged release through actual CLI',()=>staged(async({input})=>{
  const doc={...input};delete doc.confirmation;
  const script=fileURLToPath(new URL('../../scripts/inspect-offline-oci-runtime-cli.mjs',import.meta.url));
  const run=spawnSync(process.execPath,[script,'--inspect-signed-oci'],{input:JSON.stringify(doc),encoding:'utf8',timeout:15000});
  expect(run.status).toBe(0);expect(run.stderr).toBe('');
  expect(JSON.parse(run.stdout)).toMatchObject({oci_descriptor_graph_verified:true,installation_authorized:false});
 }));
 it('refuses modified layer bytes after staging',()=>staged(async({g,input})=>{
  const d=g.manifests[0].layers[0].digest;await writeFile(join(input.stagedDirectory,'payload/runtime/blobs/sha256',d.slice(7)),Buffer.from('tampered'));
  await expect(inspectOfflineOciRuntime(input)).rejects.toThrow();
 }));
 it('refuses genuinely signed non-tar bytes even with matching compressed and uncompressed digests',()=>staged(async({input})=>{
  await expect(inspectOfflineOciRuntime(input)).rejects.toThrow('OFFLINE_OCI_RUNTIME_UNVERIFIED');
 },Buffer.alloc(1024)));
 it('refuses genuinely signed malformed tar with a matching diff ID',()=>staged(async({input})=>{
  await expect(inspectOfflineOciRuntime(input)).rejects.toThrow('OFFLINE_OCI_RUNTIME_UNVERIFIED');
 },Buffer.concat([Buffer.alloc(512,65),Buffer.alloc(1024)])));
 it('refuses wrong release pin and wrong architecture',()=>staged(async({input})=>{
  await expect(inspectOfflineOciRuntime({...input,trustedManifestSha256:'a'.repeat(64)})).rejects.toThrow();
  await expect(inspectOfflineOciRuntime({...input,architecture:'arm64'})).rejects.toThrow();
 }));
});
describe('strict OCI operator input',()=>{
 const doc={architecture:'amd64',stagedDirectory:'/tmp/release-abcdef',trustedManifestSha256:'a'.repeat(64),trustedSignerSpkiSha256:'b'.repeat(64),trustedPublicKeyPem:'-----BEGIN PUBLIC KEY-----\nfixture'},bytes=Buffer.from(JSON.stringify(doc)),args=['--inspect-signed-oci'];
 it('accepts exact policy for either explicit inspection mode',()=>{
  expect(parseOfflineOciInput(bytes,args)).toEqual({confirmation:'INSPECT_SIGNED_OCI_RUNTIME_ONLY',...doc});
  expect(parseOfflineOciInput(bytes,['--observe-bound-local-runtime'])).toEqual(parseOfflineOciInput(bytes,args));
 });
 for(const [label,b,a] of [
  ['extra flag',bytes,[...args,'--force']],['missing flag',bytes,[]],['oversize',Buffer.alloc(16385),args],
  ['invalid UTF8',Buffer.from([255]),args],['duplicate',Buffer.from(JSON.stringify(doc).replace('"architecture":','"architecture":"arm64","architecture":')),args],
  ['caller image pins',Buffer.from(JSON.stringify({...doc,imageIds:{api:id('a')}})),args],
  ['relative stage',Buffer.from(JSON.stringify({...doc,stagedDirectory:'relative'})),args],
  ['wrong arch',Buffer.from(JSON.stringify({...doc,architecture:'386'})),args]
 ])it('refuses '+label,()=>expect(()=>parseOfflineOciInput(b,a)).toThrow('OFFLINE_OCI_INPUT_INVALID'));
});

describe.skipIf(process.platform!=='linux')('bounded compressed and uncompressed layer evidence',()=>{
 async function fixture(fn){
  const dir=await mkdtemp(join(await realpath(tmpdir()),'oci-layer-'));
  try{
   const raw=Buffer.alloc(4096,65),bytes=gzipSync(raw),path=join(dir,'layer');
   await writeFile(path,bytes,{mode:0o600});
   const entry={size:bytes.length,sha256:sha(bytes)},diffId='sha256:'+sha(raw);
   await fn({raw,bytes,path,entry,diffId});
  }finally{await rm(dir,{recursive:true,force:true})}
 }
 it('streams exact compressed and uncompressed digests within a strict budget',()=>fixture(async x=>{
  expect(await verifyGzipLayerFile(x.path,x.entry,x.diffId,4096)).toBe(4096);
 }));
 for(const [label,mutate] of [
  ['wrong diff ID',x=>({...x,diffId:id('a')})],
  ['wrong packed digest',x=>({...x,entry:{...x.entry,sha256:'a'.repeat(64)}})],
  ['wrong packed length',x=>({...x,entry:{...x.entry,size:x.entry.size+1}})],
  ['uncompressed limit',x=>({...x,limit:4095})],
  ['zero budget',x=>({...x,limit:0})],
  ['invalid gzip with matching packed digest',async x=>{const bad=Buffer.from('not gzip');await writeFile(x.path,bad);return {...x,entry:{size:bad.length,sha256:sha(bad)}}}],
  ['truncated gzip with matching packed digest',async x=>{const bad=x.bytes.subarray(0,x.bytes.length-3);await writeFile(x.path,bad);return {...x,entry:{size:bad.length,sha256:sha(bad)}}}],
  ['unsafe file mode',async x=>{await chmod(x.path,0o644);return x}]
 ])it('rejects '+label,()=>fixture(async input=>{
  const x=await mutate(input);
  await expect(verifyGzipLayerFile(x.path,x.entry,x.diffId,x.limit??4096)).rejects.toThrow('OFFLINE_OCI_RUNTIME_UNVERIFIED');
 }));
});
