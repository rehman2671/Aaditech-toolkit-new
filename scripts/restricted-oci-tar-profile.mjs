// Deliberately restricted, streaming USTAR inspection. Never extract bytes.
// Reject rather than interpret extensions, links, whiteouts and special files.
// Not proof of overlay/image semantics, runtime compatibility or import safety.
const fail=()=>{throw Error('RESTRICTED_OCI_TAR_PROFILE_UNVERIFIED')};
const zero=b=>b.every(x=>x===0);
function stringField(b){
 const end=b.indexOf(0),n=end<0?b.length:end;
 if((end>=0&&!zero(b.subarray(end)))||b.subarray(0,n).some(x=>x<32||x>126))fail();
 return b.subarray(0,n).toString('ascii');
}
function octal(b,allowEmpty=false){
 if(b.some(x=>x>127))fail();
 const text=b.toString('ascii');
 if(allowEmpty&&/^[\x00 ]*$/.test(text))return 0;
 if(!/^ *[0-7]+[\x00 ]*(?![\s\S])/.test(text))fail();
 const n=Number.parseInt(text.trim(),8);
 if(!Number.isSafeInteger(n)||n<0)fail();
 return n;
}
function pathname(header,isDir){
 let name=stringField(header.subarray(0,100));
 const prefix=stringField(header.subarray(345,500));
 if(!name)fail();
 if(prefix)name=prefix+'/'+name;
 if(isDir&&name.endsWith('/'))name=name.slice(0,-1);
 const parts=name.split('/');
 if(name.length>255||parts.length>32||parts.some(p=>!p||p.length>100||
  !/^[A-Za-z0-9._+-]+(?![\s\S])/.test(p)||p==='.'||p==='..'||p.startsWith('.wh.')||
  p.endsWith('.')||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p)))fail();
 return {name,parts};
}
export function createRestrictedOciTarInspector(){
 const pending=Buffer.alloc(512),seen=new Map(),implied=new Set(),caseNames=new Map();
 let used=0,remaining=0,ends=0,count=0,finished=false;
 function block(b){
  if(remaining){
   const consumed=Math.min(512,remaining);
   if(consumed<512&&!zero(b.subarray(consumed)))fail();
   remaining-=consumed;return;
  }
  if(zero(b)){ends++;return}
  if(ends)fail();
  if(++count>20000||!b.subarray(257,263).equals(Buffer.from('ustar\0'))||
   !b.subarray(263,265).equals(Buffer.from('00'))||!zero(b.subarray(500,512)))fail();
  const checksum=octal(b.subarray(148,156));
  let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:b[i];
  if(checksum!==sum)fail();
  const mode=octal(b.subarray(100,108)),size=octal(b.subarray(124,136));
  octal(b.subarray(108,116));octal(b.subarray(116,124));octal(b.subarray(136,148));
  stringField(b.subarray(265,297));stringField(b.subarray(297,329));
  if(mode>0o777||size>8*1024**3||!zero(b.subarray(157,257))||
    octal(b.subarray(329,337),true)!==0||octal(b.subarray(337,345),true)!==0)fail();
  const type=b[156],dir=type===53;
  if(!dir&&type!==48&&type!==0||dir&&size!==0)fail();
  const {name,parts}=pathname(b,dir);
  if(seen.has(name)||!dir&&implied.has(name))fail();
  for(let i=1;i<=parts.length;i++){
   const p=parts.slice(0,i).join('/'),fold=p.toLowerCase(),previous=caseNames.get(fold);
   if(previous!==undefined&&previous!==p)fail();
   caseNames.set(fold,p);
   if(i<parts.length){if(seen.get(p)==='file')fail();implied.add(p)}
  }
  if(caseNames.size>100000)fail();
  seen.set(name,dir?'directory':'file');remaining=size;
 }
 return Object.freeze({
  write(chunk){
   if(finished||!Buffer.isBuffer(chunk))fail();
   let i=0;
   while(i<chunk.length){
    if(used===0&&chunk.length-i>=512){block(chunk.subarray(i,i+512));i+=512;continue}
    const n=Math.min(512-used,chunk.length-i);chunk.copy(pending,used,i,i+n);used+=n;i+=n;
    if(used===512){block(pending);used=0}
   }
  },
  finish(){
   if(finished||used!==0||remaining!==0||ends<2)fail();
   finished=true;return Object.freeze({entries:count,restricted_profile_verified:true,extraction_authorized:false});
  }
 });
}
