// Strict streaming USTAR structural profile; never extracts or authorizes.
// Deliberately excludes links, whiteouts, extensions and special nodes.
const fail=()=>{throw Error('OCI_TAR_PROFILE_UNVERIFIED')};
const zero=b=>b.every(x=>x===0);
function text(b){
 const n=b.indexOf(0),v=n<0?b:b.subarray(0,n);
 if((n>=0&&!zero(b.subarray(n)))||v.some(x=>x<32||x>126))fail();
 return v.toString('ascii');
}
function octal(b,max){
 const raw=b.toString('latin1');
 if(!/^[0-7]+(?:\x00[ ]*|[ ]+\x00?|$)$/.test(raw))fail();
 const v=parseInt(raw,8);if(!Number.isSafeInteger(v)||v<0||v>max)fail();return v;
}
function header(b){
 if(!b.subarray(257,263).equals(Buffer.from('ustar\0'))||
 !b.subarray(263,265).equals(Buffer.from('00'))||!zero(b.subarray(500)))fail();
 let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:b[i];
 if(octal(b.subarray(148,156),262144)!==sum)fail();
 const type=b[156],directory=type===53;
 if((!directory&&type!==48&&type!==0)||!zero(b.subarray(157,257)))fail();
 const mode=octal(b.subarray(100,108),0o777);
 if(mode&0o022)fail();
 octal(b.subarray(108,116),2147483647);octal(b.subarray(116,124),2147483647);
 const size=octal(b.subarray(124,136),8*1024**3);
 octal(b.subarray(136,148),Number.MAX_SAFE_INTEGER);
 text(b.subarray(265,297));text(b.subarray(297,329));
 for(const d of [b.subarray(329,337),b.subarray(337,345)])if(!zero(d))octal(d,0);
 if(directory&&size!==0)fail();
 const name=text(b.subarray(0,100)),prefix=text(b.subarray(345,500));
 if(!name)fail();
 let path=prefix?prefix+'/'+name:name;
 if(directory&&path.endsWith('/'))path=path.slice(0,-1);
 if(!path||path.length>255||!/^[A-Za-z0-9_.+@/-]+$/.test(path))fail();
 const parts=path.split('/');
 if(parts.length>32||parts.some(s=>!s||s==='.'||s==='..'||s.length>100||
 s.endsWith('.')||s.toLowerCase().startsWith('.wh.')||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(s)))fail();
 return {path,size,directory};
}
export function createOciTarSafetyInspector(){
 let carry=Buffer.alloc(0),remaining=0,padding=0,terminators=0,ended=false,failed=false,count=0,total=0;
 const entries=new Map(),ancestors=new Map();
 function record(e){
  if(++count>100000)fail();
  const key=e.path.toLowerCase(),parts=e.path.split('/');
  if(entries.has(key)||(!e.directory&&ancestors.has(key)))fail();
  let p='';
  for(let i=0;i<parts.length-1;i++){
   p+=(i?'/':'')+parts[i];const k=p.toLowerCase(),existing=entries.get(k);
   if(existing&&(!existing.directory||existing.path!==p))fail();
   const old=ancestors.get(k);if(old!==undefined&&old!==p)fail();
   ancestors.set(k,p);if(ancestors.size>200000)fail();
  }
  const old=ancestors.get(key);if(old!==undefined&&old!==e.path)fail();
  entries.set(key,{path:e.path,directory:e.directory});
  remaining=e.size;padding=(512-e.size%512)%512;
 }
 function push(chunk){
  if(failed||ended||!Buffer.isBuffer(chunk))fail();
  try{
   total+=chunk.length;if(total>8*1024**3)fail();
   let offset=0;
   while(offset<chunk.length){
    if(remaining){const n=Math.min(remaining,chunk.length-offset);remaining-=n;offset+=n;continue}
    if(padding){const n=Math.min(padding,chunk.length-offset);if(!zero(chunk.subarray(offset,offset+n)))fail();padding-=n;offset+=n;continue}
    const n=Math.min(512-carry.length,chunk.length-offset);
    carry=Buffer.concat([carry,chunk.subarray(offset,offset+n)]);offset+=n;
    if(carry.length!==512)continue;
    if(zero(carry))terminators++;
    else{if(terminators)fail();record(header(carry))}
    carry=Buffer.alloc(0);
   }
  }catch{failed=true;fail()}
 }
 function finish(){
  if(failed||ended||carry.length||remaining||padding||terminators<2||count===0)fail();
  ended=true;return Object.freeze({entries:count,bytes:total,strict_ustar_profile_verified:true,
   archive_extracted:false,merged_rootfs_verified:false,installation_authorized:false});
 }
 return Object.freeze({push,finish});
}
