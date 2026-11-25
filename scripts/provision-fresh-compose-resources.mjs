// Candidate provisioning of empty, local, project-scoped resources only.
// No container creation/start, host mounts, ports, secrets, image pulls,
// automatic deletion, adoption, production acceptance, or rollback.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {inspectBoundOfflineRuntime,selectReleaseStoreIdentity} from './inspect-offline-oci-runtime.mjs';
import {inspectFreshComposeResources} from './fresh-compose-resource-inventory.mjs';
import {socketIdentity,requestLocalDockerJson} from './local-docker-runtime-preflight.mjs';
import {withLocalSetupLock} from './local-setup-lock.mjs';
import {rejectDuplicateJsonKeys} from './verify-lan-bundle.mjs';
const exec=promisify(execFile),binary='/usr/bin/docker',socket='/run/docker.sock';
const fail=()=>{throw Error('FRESH_COMPOSE_RESOURCE_PROVISIONING_UNCONFIRMED')};
const exact=(x,ks)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(x,k)??{},'value'));
const projectOk=x=>typeof x==='string'&&x.length>=1&&x.length<=48&&/^[a-z0-9][a-z0-9_-]*$/.test(x)&&!/[\r\n]/.test(x);
const pathOk=x=>typeof x==='string'&&x.length<=4096&&isAbsolute(x)&&resolve(x)===x&&!/[\x00-\x1f\x7f]/.test(x);
const hex=x=>typeof x==='string'&&x.length===64&&/^[a-f0-9]{64}$/.test(x)&&!/^0+$/.test(x);
const volumeRoles=['mysqldata','api_data','caddy_data','caddy_config','agent_artifacts'];
const roles=['api','database','ingress'];
export function validateFreshResourcePolicy(input){
 if(!exact(input,['confirmation','project','lockRoot','release'])||input.confirmation!=='PROVISION_EMPTY_COMPOSE_RESOURCES_ONLY_EXCLUSIVE_DAEMON_CUSTODY'||!projectOk(input.project)||!pathOk(input.lockRoot)||!exact(input.release,['confirmation','stagedDirectory','trustedManifestSha256','trustedPublicKeyPem','trustedSignerSpkiSha256','architecture']))fail();
 const r=input.release;
 if(r.confirmation!=='INSPECT_SIGNED_OCI_RUNTIME_ONLY'||!pathOk(r.stagedDirectory)||!hex(r.trustedManifestSha256)||!hex(r.trustedSignerSpkiSha256)||typeof r.trustedPublicKeyPem!=='string'||r.trustedPublicKeyPem.length<1||r.trustedPublicKeyPem.length>8192||!['amd64','arm64'].includes(r.architecture))fail();
 return Object.freeze({project:input.project,lockRoot:input.lockRoot,release:Object.freeze({...r})});
}
export function expectedFreshResources(project,releaseSha){
 if(!projectOk(project)||!hex(releaseSha))fail();
 const common={'com.docker.compose.project':project,'org.aaditech.release-sha256':releaseSha};
 return {network:{name:project+'_ittoolkit',labels:{...common,'com.docker.compose.network':'ittoolkit'}},volumes:volumeRoles.map(role=>({name:project+'_'+role,labels:{...common,'com.docker.compose.volume':role}}))};
}
const labelsMatch=(actual,expected)=>actual&&Object.keys(actual).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>actual[k]===v);
export function verifyProvisionedNetwork(doc,expected){
 if(!doc||doc.Name!==expected.name||!hex(doc.Id)||doc.Driver!=='bridge'||doc.Scope!=='local'||doc.Internal!==true||doc.Attachable!==false||doc.Ingress!==false||!labelsMatch(doc.Labels,expected.labels)||!doc.Containers||Object.keys(doc.Containers).length!==0)fail();
 return doc.Id;
}
export function verifyProvisionedVolume(doc,expected){
 if(!doc||doc.Name!==expected.name||doc.Driver!=='local'||doc.Scope!=='local'||!labelsMatch(doc.Labels,expected.labels)||!(doc.Options===null||doc.Options&&Object.keys(doc.Options).length===0))fail();
 return doc.Name;
}
async function binaryIdentity(){const s=await lstat(binary);if(!s.isFile()||s.uid!==0||(s.mode&0o022)!==0||(s.mode&0o111)===0||await realpath(binary)!==binary)fail();return [s.dev,s.ino,s.uid,s.mode,s.size,s.mtimeMs,s.ctimeMs]}
export async function provisionFreshComposeResources(input){
 const p=validateFreshResourcePolicy(input);
 return withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:p.lockRoot},async({assertHeld})=>{
  const b=await binaryIdentity(),s=await socketIdentity(),initial=await requestLocalDockerJson(socket,'/info'),daemon=initial.value?.ID;
  if(initial.missing!==false||typeof daemon!=='string'||!daemon||initial.value.OSType!=='linux')fail();
  async function continuity(){await assertHeld();if(JSON.stringify(await binaryIdentity())!==JSON.stringify(b)||JSON.stringify(await socketIdentity())!==JSON.stringify(s))fail();const d=await requestLocalDockerJson(socket,'/info');if(d.missing!==false||d.value?.ID!==daemon||d.value.OSType!=='linux')fail();await assertHeld();return d}
  async function run(args){await continuity();let r;try{r=await exec(binary,['--host','unix:///run/docker.sock',...args],{encoding:'utf8',timeout:30000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_CONFIG:'/nonexistent'}})}catch{fail()}await continuity();return r.stdout}
  async function inspect(type,key){const raw=await run([type,'inspect',key]);rejectDuplicateJsonKeys(raw);const rows=JSON.parse(raw);if(!Array.isArray(rows)||rows.length!==1)fail();return rows[0]}
  const bound=await inspectBoundOfflineRuntime(p.release);
  if(!bound.runtime.all_expected_image_ids_observed||!bound.release.release_signature_verified||bound.release.approved_manifest_sha256!==p.release.trustedManifestSha256)fail();
  const store=selectReleaseStoreIdentity(await continuity(),p.release.architecture,bound.release.images);
  if(store.store!==bound.store_profile)fail();
  // Verify exact image and ordered layer IDs, not only a mutable tag.
  async function verifyImages(){
   const current=selectReleaseStoreIdentity(await continuity(),p.release.architecture,bound.release.images);
   if(JSON.stringify(current)!==JSON.stringify(store))fail();
   for(const role of roles){
    const image=await inspect('image',store.imageIds[role]),release=bound.release.images.find(x=>x.role===role);
    if(image.Id!==store.imageIds[role]||image.Os!=='linux'||image.Architecture!==p.release.architecture||JSON.stringify(image.RootFS?.Layers)!==JSON.stringify(release.layers.map(x=>x.diff_id))||!Array.isArray(image.RepoTags??[])||(image.RepoTags??[]).length)fail();
   }
  }
  const expected=expectedFreshResources(p.project,p.release.trustedManifestSha256);
  const inventory=async(networks,volumes)=>{
   await continuity();const r=await inspectFreshComposeResources({confirmation:'INSPECT_FRESH_COMPOSE_RESOURCE_COLLISIONS_ONLY',project:p.project});await continuity();
   if(r.collision_counts.containers!==0||r.collision_counts.networks!==networks||r.collision_counts.volumes!==volumes)fail();
  };
  const labelArgs=e=>Object.entries(e.labels).flatMap(([k,v])=>['--label',k+'='+v]);
  await verifyImages();await inventory(0,0);
  const networkId=(await run(['network','create','--driver','bridge','--internal',...labelArgs(expected.network),expected.network.name])).trim();
  if(!hex(networkId)||verifyProvisionedNetwork(await inspect('network',networkId),expected.network)!==networkId)fail();
  const names=[];
  for(const v of expected.volumes){
   await inventory(1,names.length);
   // Docker volume create is idempotent by name, so both prior inventory and
   // exact label/driver inspection are mandatory under exclusive custody.
   const name=(await run(['volume','create','--driver','local',...labelArgs(v),v.name])).trim();
   if(name!==v.name||verifyProvisionedVolume(await inspect('volume',name),v)!==name)fail();
   names.push(name);
  }
  await inventory(1,5);
  if(verifyProvisionedNetwork(await inspect('network',networkId),expected.network)!==networkId)fail();
  for(const v of expected.volumes)verifyProvisionedVolume(await inspect('volume',v.name),v);
  await verifyImages();
  const final=await inspectBoundOfflineRuntime(p.release);if(JSON.stringify(final)!==JSON.stringify(bound))fail();
  await continuity();await inventory(1,5);
  return {schema_version:1,project:p.project,release_sha256:p.release.trustedManifestSha256,network_id:networkId,network_name:expected.network.name,volume_names:names,resources_provisioned:true,containers_created:false,services_started:false,host_database_absence_verified:false,installation_authorized:false,production_accepted:false};
 });
}
