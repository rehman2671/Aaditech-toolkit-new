import {describe,it,expect} from 'vitest';
import {expectedSyntheticImages as expected,verifySyntheticLoadedImage as verify} from '../fixtures/docker-load-evidence.mjs';
const id=c=>'sha256:'+c.repeat(64),roles=['api','database','ingress'];
const release=()=>({architecture:'amd64',cross_layer_path_profile_verified:true,images:roles.map((role,i)=>({role,image_config_id:id('abc'[i]),layer_count:2,layers:[{diff_id:id('d')},{diff_id:id('e')}]}))});
const row=e=>({Id:e.id,Os:'linux',Architecture:'amd64',RepoTags:null,RepoDigests:[],RootFS:{Type:'layers',Layers:[...e.diffIds]}});
describe('disposable loader evidence validation',()=>{
 it('derives exact three immutable identities and ordered diff IDs',()=>{const r=expected(release());expect(Object.keys(r)).toEqual(roles);expect(Object.isFrozen(r.api.diffIds)).toBe(true)});
 it.each([
 ['wrong arch',r=>r.architecture='arm64'],['unverified path profile',r=>r.cross_layer_path_profile_verified=false],
 ['missing role',r=>r.images.pop()],['extra role',r=>r.images.push(r.images[0])],
 ['unknown role',r=>r.images[0].role='worker'],['duplicate role',r=>r.images[1].role='api'],
 ['duplicate ID',r=>r.images[1].image_config_id=r.images[0].image_config_id],
 ['zero ID',r=>r.images[0].image_config_id=id('0')],['short ID',r=>r.images[0].image_config_id='sha256:a'],
 ['sparse images',r=>delete r.images[0]],['missing layer',r=>r.images[0].layers.pop()],
 ['sparse layers',r=>delete r.images[0].layers[0]],['wrong count',r=>r.images[0].layer_count=3],
 ['empty layers',r=>{r.images[0].layers=[];r.images[0].layer_count=0}],
 ['zero diff ID',r=>r.images[0].layers[0].diff_id=id('0')],['uppercase diff ID',r=>r.images[0].layers[0].diff_id=id('A')]
 ])('rejects release %s',(_label,change)=>{const r=release();change(r);expect(()=>expected(r)).toThrow()});
 for(const role of roles){
  it('verifies exact untagged '+role,()=>{const e=expected(release())[role];expect(verify(e,row(e))).toMatchObject({id_verified:true,ordered_diff_ids_verified:true,untagged:true,container_executed:false,production_accepted:false})});
  it.each([
   ['wrong ID',x=>x.Id=id('f')],['missing ID',x=>delete x.Id],['wrong OS',x=>x.Os='windows'],
   ['wrong arch',x=>x.Architecture='arm64'],['tagged',x=>x.RepoTags=['fixture:latest']],
   ['repo digest',x=>x.RepoDigests=['fixture@'+id('f')]],['missing tag evidence',x=>delete x.RepoTags],
   ['wrong rootfs type',x=>x.RootFS.Type='other'],['wrong layer order',x=>x.RootFS.Layers.reverse()],
   ['missing layer',x=>x.RootFS.Layers.pop()],['extra layer',x=>x.RootFS.Layers.push(id('f'))],
   ['sparse layer',x=>delete x.RootFS.Layers[0]]
  ])('rejects '+role+' %s',(_label,change)=>{const e=expected(release())[role],x=row(e);change(x);expect(()=>verify(e,x)).toThrow()});
 }
});
