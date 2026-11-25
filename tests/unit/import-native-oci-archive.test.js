import {it,expect} from 'vitest';
import {validateNativeStore,verifyImportedNativeImage} from '../../scripts/import-native-oci-archive.mjs';
const info={missing:false,value:{OSType:'linux',Architecture:'x86_64',ID:'fixture',DriverStatus:[['driver-type','io.containerd.snapshotter.v1']]}};
const image={manifest_id:'sha256:'+'a'.repeat(64),diff_ids:['sha256:'+'b'.repeat(64)]};
const observed={missing:false,value:{Id:image.manifest_id,Os:'linux',Architecture:'amd64',RepoTags:[],RootFS:{Type:'layers',Layers:image.diff_ids}}};
it('requires observed native containerd store and exact architecture',()=>{expect(validateNativeStore(info,'amd64')).toBe('fixture');expect(()=>validateNativeStore({...info,value:{...info.value,DriverStatus:[]}},'amd64')).toThrow();expect(()=>validateNativeStore(info,'arm64')).toThrow()});
it('requires original manifest ID, ordered layers and no tags after import',()=>{expect(verifyImportedNativeImage(observed,image,'amd64')).toBe(true);for(const patch of [{Id:'sha256:'+'c'.repeat(64)},{RepoTags:['unexpected:latest']},{RootFS:{Type:'layers',Layers:[]}}])expect(()=>verifyImportedNativeImage({...observed,value:{...observed.value,...patch}},image,'amd64')).toThrow()});
