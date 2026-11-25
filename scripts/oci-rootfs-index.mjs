// Conservative cross-layer namespace model for already validated regular
// file/directory-only USTAR members. No extraction, whiteouts or type changes.
// Never expose filenames, metadata, or a runtime authorization.
const fail=()=>{throw Error('OCI_ROOTFS_PATH_PROFILE_UNVERIFIED')};
export function createRestrictedRootfsIndex(){
 const nodes=new Map();let count=0,finished=false,failed=false;
 function add(path,directory,explicit){
  const key=path.toLowerCase(),old=nodes.get(key);
  if(old&&(old.path!==path||old.directory!==directory))fail();
  if(!old){if(nodes.size>=200000)fail();nodes.set(key,{path,directory})}
 }
 return Object.freeze({
  apply(records){
   if(finished||failed)fail();
   try{
    if(!Array.isArray(records)||records.length<1||records.length>100000)fail();
    const seen=new Set();
    for(const r of records){
     if(!r||typeof r.path!=='string'||typeof r.directory!=='boolean'||r.path.length>255||
      !/^[A-Za-z0-9_.+@/-]+(?![\s\S])/.test(r.path))fail();
     const parts=r.path.split('/');
     if(parts.length>32||parts.some(p=>!p||p.length>100||p==='.'||p==='..'||p.endsWith('.')||
      p.toLowerCase().startsWith('.wh.')||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p)))fail();
     if(++count>200000||seen.has(r.path.toLowerCase()))fail();
     seen.add(r.path.toLowerCase());
     for(let i=1;i<parts.length;i++)add(parts.slice(0,i).join('/'),true,false);
     add(r.path,r.directory,true);
    }
   }catch{failed=true;fail()}
  },
  finish(){
   if(finished||failed||count===0)fail();finished=true;
   return Object.freeze({cross_layer_path_profile_verified:true,merged_rootfs_verified:false,installation_authorized:false});
  }
 });
}
