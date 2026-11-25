import {describe,it,expect} from 'vitest';
import {createOciTarSafetyInspector} from '../../scripts/oci-tar-safety.mjs';
function checksum(h){h.fill(32,148,156);h.write(h.reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148,'ascii');return h}
function member(name='file',options={}){
 const {type='0',mode='0000644\0',size=1,prefix='',link='',change=null}=options;
 const h=Buffer.alloc(512);h.write(name,0,'ascii');h.write(mode,100,'ascii');
 h.write('0000000\0',108,'ascii');h.write('0000000\0',116,'ascii');h.write(size.toString(8).padStart(11,'0')+'\0',124,'ascii');
 h.write('00000000000\0',136,'ascii');h[156]=type.charCodeAt(0);h.write(link,157,'ascii');
 h.write('ustar\0',257,'ascii');h.write('00',263,'ascii');h.write(prefix,345,'ascii');
 if(change)change(h);checksum(h);
 const data=Buffer.alloc(Math.ceil(size/512)*512);if(size)data.fill(65,0,size);
 return Buffer.concat([h,data]);
}
const end=Buffer.alloc(1024);
function inspect(bytes,chunk=4096){const p=createOciTarSafetyInspector();for(let i=0;i<bytes.length;i+=chunk)p.push(bytes.subarray(i,i+chunk));return p.finish()}
const archive=(...members)=>Buffer.concat([...members,end]);
describe('strict streaming USTAR structural safety',()=>{
 for(const chunk of [1,7,511,512,513,1024,16384])
  it('handles chunk boundary '+chunk,()=>expect(inspect(archive(member('app/',{type:'5',size:0}),member('app/file')),chunk)).toMatchObject({entries:2,strict_ustar_profile_verified:true,archive_extracted:false,installation_authorized:false}));
 for(const name of ['/etc/passwd','../file','a/../b','./file','a/./b','a//b','a/','a\\b','C:foo','a b','a\tname','a.','a/.wh.secret','.wh..wh..opq','a/.WH.foo','NUL','com1.txt','a/PRN','a?b','a*b','a|b','a<b','a>b','a"b','a#b'])
  it('refuses path '+JSON.stringify(name),()=>expect(()=>inspect(archive(member(name)))).toThrow('OCI_TAR_PROFILE_UNVERIFIED'));
 for(const type of ['1','2','3','4','6','7','x','g','L','K','S','D','M','V'])
  it('refuses type '+type,()=>expect(()=>inspect(archive(member('file',{type})))).toThrow('OCI_TAR_PROFILE_UNVERIFIED'));
 for(const mode of ['0004755\0','0002755\0','0001755\0','0000666\0','0000777\0','0000620\0','0000602\0','0000899\0'])
  it('refuses mode '+JSON.stringify(mode),()=>expect(()=>inspect(archive(member('file',{mode})))).toThrow('OCI_TAR_PROFILE_UNVERIFIED'));
 for(const [label,members] of [
  ['duplicate',[member('a'),member('a')]],['case duplicate',[member('A'),member('a')]],
  ['file ancestor',[member('a'),member('a/b')]],['file ancestor late',[member('a/b'),member('a')]],
  ['implicit ancestor case',[member('A/b'),member('a/c')]],['directory case',[member('A/',{type:'5',size:0}),member('a/b')]],
  ['directory collision',[member('a/',{type:'5',size:0}),member('a')]],['directory has payload',[member('a/',{type:'5',size:1})]],
  ['link target',[member('a',{link:'b'})]],['prefix traversal',[member('a',{prefix:'../bad'})]],
  ['too deep',[member(Array(33).fill('a').join('/'))]]
 ])it('rejects '+label,()=>expect(()=>inspect(archive(...members))).toThrow('OCI_TAR_PROFILE_UNVERIFIED'));
 for(const [label,change] of [
  ['invalid magic',h=>h.write('xxxxx',257)],['invalid version',h=>h.write('01',263)],
  ['header trailing bytes',h=>h[511]=1],['hidden name suffix',h=>{h[10]=0;h[11]=65}],
  ['base256 size',h=>h[124]=128],['invalid UID',h=>h.write('0000008',108)],
  ['negative timestamp',h=>h[136]=45],['device number',h=>h.write('0000001\0',329)]
 ])it('rejects '+label,()=>expect(()=>inspect(archive(member('file',{change})))).toThrow('OCI_TAR_PROFILE_UNVERIFIED'));
 it('rejects bad checksum',()=>{const b=archive(member());b[0]^=1;expect(()=>inspect(b)).toThrow()});
 it('rejects nonzero padding',()=>{const b=archive(member());b[513]=1;expect(()=>inspect(b)).toThrow()});
 it('rejects missing terminators',()=>expect(()=>inspect(member())).toThrow());
 it('rejects single terminator',()=>expect(()=>inspect(Buffer.concat([member(),Buffer.alloc(512)]))).toThrow());
 it('rejects truncated data',()=>expect(()=>inspect(member().subarray(0,512))).toThrow());
 it('rejects trailing partial block',()=>expect(()=>inspect(Buffer.concat([archive(member()),Buffer.alloc(1)]))).toThrow());
 it('rejects appended archive',()=>expect(()=>inspect(Buffer.concat([archive(member()),archive(member('other'))]))).toThrow());
 it('rejects empty archive',()=>expect(()=>inspect(end)).toThrow());
 it('accepts canonical prefix and implicit directory',()=>expect(inspect(archive(member('file',{prefix:'app/lib'}),member('app/',{type:'5',size:0}))).entries).toBe(2));
 it('accepts extra complete zero padding',()=>expect(inspect(Buffer.concat([archive(member()),Buffer.alloc(512)])).entries).toBe(1));
 it('rejects use after finish',()=>{const p=createOciTarSafetyInspector();p.push(archive(member()));p.finish();expect(()=>p.push(end)).toThrow();expect(()=>p.finish()).toThrow()});
 it('rejects nonbuffer input',()=>expect(()=>createOciTarSafetyInspector().push('data')).toThrow());
});
