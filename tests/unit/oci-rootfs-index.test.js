import {describe,it,expect} from 'vitest';
import {createRestrictedRootfsIndex as create} from '../../scripts/oci-rootfs-index.mjs';
const f=path=>({path,directory:false}),d=path=>({path,directory:true});
const inspect=(...layers)=>{const x=create();for(const layer of layers)x.apply(layer);return x.finish()};
describe('restricted cross-layer path namespace',()=>{
 for(const root of ['app','usr','var','etc','opt','srv','lib','bin']){
  it('refuses file ancestor across layers '+root,()=>expect(()=>inspect([f(root)],[f(root+'/child')])).toThrow());
  it('refuses replacing implicit directory '+root,()=>expect(()=>inspect([f(root+'/child')],[f(root)])).toThrow());
  it('refuses explicit directory replacement '+root,()=>expect(()=>inspect([d(root)],[f(root)])).toThrow());
  it('refuses cross-layer case alias '+root,()=>expect(()=>inspect([f(root+'/file')],[f(root.toUpperCase()+'/other')])).toThrow());
  it('accepts same-path file replacement '+root,()=>expect(inspect([f(root+'/file')],[f(root+'/file')])).toMatchObject({cross_layer_path_profile_verified:true,merged_rootfs_verified:false,installation_authorized:false}));
  it('accepts directory reuse '+root,()=>expect(inspect([d(root),f(root+'/a')],[d(root),f(root+'/b')])).toMatchObject({cross_layer_path_profile_verified:true}));
 }
 it('refuses empty layers',()=>expect(()=>inspect([])).toThrow());
 it('refuses duplicate within layer',()=>expect(()=>inspect([f('a'),f('a')])).toThrow());
 it('refuses file to directory conversion',()=>expect(()=>inspect([f('a')],[d('a')])).toThrow());
 it('refuses a failed index from issuing a report',()=>{const x=create();x.apply([f('a')]);expect(()=>x.apply([f('a/b')])).toThrow();expect(()=>x.finish()).toThrow()});
 it('refuses reuse after finish',()=>{const x=create();x.apply([f('a')]);x.finish();expect(()=>x.apply([f('b')])).toThrow()});
 it('refuses empty index report',()=>expect(()=>create().finish()).toThrow());
});
