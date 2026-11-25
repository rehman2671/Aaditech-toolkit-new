// Narrow OCI image-layout reference inside a publisher-signed staged LAN bundle.
// No decompression, extraction, daemon mutation or runtime authorization.
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectStagedLanBundle} from './inspect-staged-lan-bundle.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
import {inspectLocalDockerRuntime} from './local-docker-runtime-preflight.mjs';

const roles=['api','database','ingress'];
const types=Object.freeze({index:'application/vnd.oci.image.index.v1+json',
 manifest:'application/vnd.oci.image.manifest.v1+json',config:'application/vnd.oci.image.config.v1+json',
 layer:'application/vnd.oci.image.layer.v1.tar+gzip'});
const fail=()=>{throw Error('OFFLINE_OCI_RUNTIME_UNVERIFIED')};
const sha=b=>createHash('sha256').update(b).digest('hex');
const digest=d=>typeof d==='string'&&d.length===71&&/^sha256:[a-f0-9]{64}$/.test(d)&&!/^sha256:0+$/.test(d);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const arch=x=>['amd64','arm64'].includes(x);
const blobPath=d=>'runtime/blobs/sha256/'+d.slice(7);
const meta=['dev','ino','size','mtimeMs','ctimeMs','uid','mode','nlink'];
const same=(a,b)=>meta.every(k=>a[k]===b[k]);
async function readJson(path,expected,max=1024*1024){
 const st=await lstat(path);
 if(!st.isFile()||st.nlink!==1||st.uid!==process.geteuid()||(st.mode&0o7777)!==0o600||
    st.size<1||st.size>max||(expected&&st.size!==expected.size))fail();
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(!same(st,await fd.stat()))fail();
  const b=Buffer.alloc(st.size+1);let n=0;
  while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead}
  if(n!==st.size||!same(st,await fd.stat())||!same(st,await lstat(path)))fail();
  const bytes=b.subarray(0,n),hash=sha(bytes);
  if(expected&&hash!==expected.sha256)fail();
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  rejectDuplicateJsonKeys(raw);
  return {doc:JSON.parse(raw),hash};
 }finally{await fd.close()}
}
function descriptor(d,type,extra=[]){
 if(!exact(d,['mediaType','digest','size',...extra])||d.mediaType!==type||
   !digest(d.digest)||!Number.isSafeInteger(d.size)||d.size<1||d.size>64*1024**3)fail();
 return d;
}
// This structural validator accepts only an intentionally limited, single
// architecture OCI profile with three role-tagged manifests, gzip layers,
// no external URLs, embedded data, alternate media or extra runtime files.
export async function verifyOfflineOciGraph({architecture,entries,readMetadata}){
 if(!arch(architecture)||!Array.isArray(entries)||typeof readMetadata!=='function')fail();
 const files=new Map(),used=new Set();
 for(const e of entries){
  if(!plain(e)||typeof e.path!=='string'||files.has(e.path)||!Number.isSafeInteger(e.size)||
   e.size<0||typeof e.sha256!=='string'||e.sha256.length!==64||!/^[a-f0-9]{64}$/.test(e.sha256))fail();
  files.set(e.path,e);
 }
 const mark=(path,d)=>{
  const e=files.get(path);
  if(!e||(d&&(e.sha256!==d.digest.slice(7)||e.size!==d.size)))fail();
  used.add(path);return e;
 };
 const metadata=async(path,d)=>readMetadata(path,mark(path,d));
 const layout=await metadata('runtime/oci-layout');
 if(!exact(layout,['imageLayoutVersion'])||layout.imageLayoutVersion!=='1.0.0')fail();
 const index=await metadata('runtime/index.json');
 if(!exact(index,['schemaVersion','mediaType','manifests'])||index.schemaVersion!==2||
    index.mediaType!==types.index||!Array.isArray(index.manifests)||index.manifests.length!==3)fail();
 const result=[],seenRoles=new Set(),seenManifests=new Set(),seenConfigs=new Set();
 for(const item of index.manifests){
  descriptor(item,types.manifest,['platform','annotations']);
  if(!exact(item.platform,['architecture','os'])||item.platform.architecture!==architecture||item.platform.os!=='linux'||
   !exact(item.annotations,['org.aaditech.role']))fail();
  const role=item.annotations['org.aaditech.role'];
  if(!roles.includes(role)||seenRoles.has(role)||seenManifests.has(item.digest))fail();
  seenRoles.add(role);seenManifests.add(item.digest);
  const m=await metadata(blobPath(item.digest),item);
  if(!exact(m,['schemaVersion','mediaType','config','layers'])||m.schemaVersion!==2||
    m.mediaType!==types.manifest||!Array.isArray(m.layers)||m.layers.length<1||m.layers.length>128)fail();
  const c=descriptor(m.config,types.config);
  if(seenConfigs.has(c.digest))fail();seenConfigs.add(c.digest);
  const config=await metadata(blobPath(c.digest),c);
  if(!plain(config)||config.os!=='linux'||config.architecture!==architecture||
   !exact(config.rootfs,['type','diff_ids'])||config.rootfs.type!=='layers'||
   !Array.isArray(config.rootfs.diff_ids)||config.rootfs.diff_ids.length!==m.layers.length||
   !config.rootfs.diff_ids.every(digest))fail();
  for(const layer of m.layers){descriptor(layer,types.layer);mark(blobPath(layer.digest),layer)}
  result.push(Object.freeze({role,manifest_digest:item.digest,image_config_id:c.digest,layer_count:m.layers.length}));
 }
 // Reject unreferenced runtime bytes, including unknown metadata and blobs.
 if([...files.keys()].some(k=>k.startsWith('runtime/')&&!used.has(k)))fail();
 return Object.freeze(roles.map(role=>result.find(x=>x.role===role)));
}
export async function inspectOfflineOciRuntime(input={}){
 const {confirmation,stagedDirectory,trustedManifestSha256,trustedPublicKeyPem,trustedSignerSpkiSha256,architecture}=input;
 if(confirmation!=='INSPECT_SIGNED_OCI_RUNTIME_ONLY'||!arch(architecture))fail();
 const pins={confirmation:'INSPECT_STAGED_RELEASE_ONLY',stagedDirectory,trustedManifestSha256,trustedPublicKeyPem,trustedSignerSpkiSha256};
 const prior=await inspectStagedLanBundle(pins);
 const manifest=await readJson(join(stagedDirectory,'manifest.json'),null,2*1024*1024);
 if(manifest.hash!==prior.approved_manifest_sha256)fail();
 const images=await verifyOfflineOciGraph({architecture,entries:manifest.doc.files,
  readMetadata:async(path,entry)=>(await readJson(join(stagedDirectory,'payload',path),entry)).doc});
 const final=await inspectStagedLanBundle(pins);
 if(JSON.stringify(prior)!==JSON.stringify(final))fail();
 return Object.freeze({schema_version:1,architecture,approved_manifest_sha256:prior.approved_manifest_sha256,
   images,release_signature_verified:true,compressed_blob_integrity_verified:true,oci_descriptor_graph_verified:true,
   uncompressed_diff_ids_verified:false,archive_extraction_verified:false,image_imported:false,
   runtime_compatibility_verified:false,installation_authorized:false,production_accepted:false});
}
// Only derive the daemon observation pins from the authenticated release.
// Recheck the release after observing the daemon; this is not an execution lock.
export async function inspectBoundOfflineRuntime(input={}){
 const snapshot={...input};
 const release=await inspectOfflineOciRuntime(snapshot);
 const runtime=await inspectLocalDockerRuntime({confirmation:'OBSERVE_LOCAL_DOCKER_ONLY',architecture:release.architecture,
   imageIds:Object.fromEntries(release.images.map(x=>[x.role,x.image_config_id]))});
 const final=await inspectOfflineOciRuntime(snapshot);
 if(JSON.stringify(release)!==JSON.stringify(final))fail();
 return Object.freeze({schema_version:1,decision:runtime.decision,release,runtime,
  image_imported:false,installation_authorized:false,production_accepted:false});
}
