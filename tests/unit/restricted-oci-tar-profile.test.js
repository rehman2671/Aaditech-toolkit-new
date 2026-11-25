import {describe,it,expect} from 'vitest';
import {createRestrictedOciTarInspector as create} from '../../scripts/restricted-oci-tar-profile.mjs';
const field=(b,start,end,value)=>{b.fill(0,start,end);Buffer.from(value,'ascii').copy(b,start,0,end-start)};
const num=(b,start,end,n)=>field(b,start,end,n.toString(8).padStart(end-start-1,'0')+'\0');
function checksum(b){b.fill(32,148,156);let sum=0;for(const x of b)sum+=x;field(b,148,156,sum.toString(8).padStart(6,'0')+'\0 ');return b}
function header(name='app/file',size=0,type='0'){
 const b=Buffer.alloc(512);field(b,0,100,name);num(b,100,108,0o644);
 num(b,108,116,0);num(b,116,124,0);num(b,124,136,size);num(b,136,148,0);
 field(b,156,157,type);field(b,257,263,'ustar\0');field(b,263,265,'00');
 return checksum(b);
}
const ends=Buffer.alloc(1024);
const inspect=(...parts)=>{const i=create();for(const p of parts)i.write(p);return i.finish()};
const invalidPaths=['/etc/passwd','../escape','a/../../b','a/./b','a//b','./file','a\\b','C:drive','a b','a?b','a*b','a|b','a<b','a>b','a"b','a\tb','a\nb','a/..','a/.','a/.wh.deleted','a/.wh..wh..opq','CON','NUL.txt','COM1','a/LPT9','a/trailing.','a/file/','a/'.repeat(33)+'b',''];
describe('bounded restricted USTAR profile',()=>{
 it.each(invalidPaths)('rejects unsafe path %j',name=>expect(()=>inspect(header(name),ends)).toThrow('RESTRICTED_OCI_TAR_PROFILE_UNVERIFIED'));
 it.each(['1','2','3','4','6','7','x','g','L','K','S','V'])('refuses unsupported tar entry type %s',type=>expect(()=>inspect(header('file',0,type),ends)).toThrow());
 it.each([
 ['bad magic',b=>field(b,257,263,'ustar ')],
 ['bad version',b=>field(b,263,265,'01')],
 ['mode setuid',b=>num(b,100,108,0o4644)],
 ['mode setgid',b=>num(b,100,108,0o2644)],
 ['sticky mode',b=>num(b,100,108,0o1644)],
 ['base256 size',b=>b[124]=0x80],
 ['invalid octal',b=>field(b,124,136,'00000000009')],
 ['link target',b=>field(b,157,257,'other')],
 ['device major',b=>num(b,329,337,1)],
 ['device minor',b=>num(b,337,345,1)],
 ['nonzero reserved bytes',b=>b[511]=1],
 ['hidden name suffix',b=>b[99]=65],
 ['control username',b=>b[265]=1],
 ['invalid owner number',b=>field(b,108,116,'-1')]
 ])('rejects %s header',(_label,change)=>{const b=header();change(b);expect(()=>inspect(checksum(b),ends)).toThrow()});
 it('accepts empty archive, regular data and explicit directories under arbitrary chunk boundaries',()=>{
  expect(inspect(ends)).toMatchObject({entries:0,extraction_authorized:false});
  const content=Buffer.alloc(512);content.write('hello');
  const bytes=Buffer.concat([header('app/',0,'5'),header('app/file',5),content,ends]);
  const i=create();for(let n=0;n<bytes.length;n+=13)i.write(bytes.subarray(n,n+13));
  expect(i.finish()).toMatchObject({entries:2,restricted_profile_verified:true,extraction_authorized:false});
 });
 it('accepts USTAR prefix and a directory explicitly declared after its child',()=>{
  const b=header('file');field(b,345,500,'app');checksum(b);
  expect(inspect(b,header('app/',0,'5'),ends).entries).toBe(2);
 });
 it.each([
 ['duplicate path',()=>[header('a'),header('a'),ends]],
 ['case alias',()=>[header('a'),header('A'),ends]],
 ['ancestor case alias',()=>[header('a/x'),header('A/y'),ends]],
 ['file ancestor',()=>[header('a'),header('a/x'),ends]],
 ['file replaces implicit directory',()=>[header('a/x'),header('a'),ends]],
 ['nonempty directory',()=>[header('a',1,'5'),ends]],
 ['one end block',()=>[header(),Buffer.alloc(512)]],
 ['trailing nonzero block',()=>[ends,header()]],
 ['truncated block',()=>[ends,Buffer.alloc(1)]],
 ['missing file data',()=>[header('a',4096),ends]],
 ['nonzero padding',()=>[header('a',1),Buffer.alloc(512,65),ends]],
 ['bad checksum',()=>{const b=header();b[0]^=1;return [b,ends]}]
 ])('rejects %s',(_label,parts)=>expect(()=>inspect(...parts())).toThrow());
 it('rejects writes after a finished inspection',()=>{const i=create();i.write(ends);i.finish();expect(()=>i.write(ends)).toThrow()});
});
