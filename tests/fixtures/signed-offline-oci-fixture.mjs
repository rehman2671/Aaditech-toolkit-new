// Disposable test-only signed OCI fixture.
import {createHash,generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdtemp,mkdir,chmod,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {stageOfflineLanBundle} from '../../scripts/stage-offline-lan-bundle.mjs';
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
 const layerBytes=Array.isArray(layerOverride)?layerOverride:[layerOverride??Buffer.concat([h,data,Buffer.alloc(1024)])];
 const layers=layerBytes.map(b=>blob(gzipSync(b),types.layer));
 const index={schemaVersion:2,mediaType:types.index,manifests:[]};
 for(const role of roles){
  const config={architecture,os:'linux',config:{...(role==='api'?{User:'1000:1000'}:{}),Env:['SECRET=fixture'],Cmd:['/fixture-not-executed'],Labels:{role,fixture:randomUUID()}},rootfs:{type:'layers',diff_ids:layerBytes.map(b=>'sha256:'+sha(b))}};
  const c=jsonBlob(config,types.config),manifest={schemaVersion:2,mediaType:types.manifest,config:c,layers:layers.map(l=>({...l}))};
  const m=jsonBlob(manifest,types.manifest);configs.push(config);manifests.push(manifest);
  index.manifests.push({...m,platform:{architecture,os:'linux'},annotations:{'org.aaditech.role':role}});
 }
 const layout={imageLayoutVersion:'1.0.0'};put('runtime/oci-layout',layout);put('runtime/index.json',index);
 const entries=[...files].map(([path,b])=>({path,size:b.length,sha256:sha(b)}));
 const input={architecture,entries,readMetadata:async path=>docs.get(path)};
 return {files,docs,configs,manifests,index,layout,entries,input};
}
export async function staged(fn,layerOverride=null,extraFiles=new Map()){
 const dir=await mkdtemp(join(await realpath(tmpdir()),'oci-lan-'));
 try{
  const g=graph('amd64',layerOverride),root=join(dir,'source'),destinationParent=join(dir,'dest');
  for(const [path,bytes] of extraFiles){if(g.files.has(path)||!Buffer.isBuffer(bytes))throw Error('INVALID_EXTRA_FIXTURE');g.files.set(path,bytes);g.entries.push({path,size:bytes.length,sha256:sha(bytes)})}
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
