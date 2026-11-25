// Test-only evidence validator: no daemon operations, no authority.
const fail=()=>{throw Error('DISPOSABLE_DOCKER_LOAD_EVIDENCE_INVALID')};
const digest=x=>typeof x==='string'&&x.length===71&&/^sha256:[a-f0-9]{64}$/.test(x)&&!/^sha256:0+$/.test(x);
const dense=(a,max)=>Array.isArray(a)&&a.length<=max&&Object.keys(a).length===a.length&&
 Array.from({length:a.length},(_,i)=>Object.hasOwn(a,i)).every(Boolean);
const roles=['api','database','ingress'];
export function expectedSyntheticImages(release){
 if(!release||release.architecture!=='amd64'||release.cross_layer_path_profile_verified!==true||
    !dense(release.images,3)||release.images.length!==3)fail();
 const expected={},seen=new Set();
 for(const image of release.images){
  if(!image||!roles.includes(image.role)||Object.hasOwn(expected,image.role)||
     !digest(image.image_config_id)||seen.has(image.image_config_id)||
     !dense(image.layers,128)||image.layers.length<1||image.layer_count!==image.layers.length||
     !image.layers.every(l=>l&&digest(l.diff_id)))fail();
  seen.add(image.image_config_id);
  expected[image.role]=Object.freeze({id:image.image_config_id,diffIds:Object.freeze(image.layers.map(l=>l.diff_id))});
 }
 return Object.freeze(expected);
}
const empty=a=>a===null||(Array.isArray(a)&&a.length===0&&Object.keys(a).length===0);
export function verifySyntheticLoadedImage(expected,observed){
 if(!expected||!digest(expected.id)||!dense(expected.diffIds,128)||!expected.diffIds.length||
    !expected.diffIds.every(digest)||!observed||observed.Id!==expected.id||observed.Os!=='linux'||
    observed.Architecture!=='amd64'||!empty(observed.RepoTags)||!empty(observed.RepoDigests)||
    observed.RootFS?.Type!=='layers'||!dense(observed.RootFS.Layers,128)||
    observed.RootFS.Layers.length!==expected.diffIds.length||
    observed.RootFS.Layers.some((v,i)=>v!==expected.diffIds[i]))fail();
 return Object.freeze({id_verified:true,ordered_diff_ids_verified:true,untagged:true,container_executed:false,production_accepted:false});
}
