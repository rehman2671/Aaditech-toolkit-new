import {it,expect} from 'vitest';
import {classifyFreshComposeInventory as classify,selectProjectCollisions as select,classifyProjectRecovery as recovery} from '../../scripts/fresh-compose-resource-inventory.mjs';
const project='aaditech',empty={containers:[],networks:[],volumes:[]},id='a'.repeat(64);
it('reports only collision absence without installing or approving',()=>expect(classify(project,empty)).toMatchObject({resource_collision_free_observed:true,host_database_absence_verified:false,installation_authorized:false,production_accepted:false}));
it.each(['db','api','caddy'])('blocks canonical or legacy container name %s',role=>{for(const name of [project+'-'+role+'-1',project+'_'+role+'_1'])expect(classify(project,{...empty,containers:[{id,name,project:''}]}).collision_counts.containers).toBe(1)});
it.each(['mysqldata','api_data','caddy_data','caddy_config','agent_artifacts'])('blocks expected volume %s',role=>expect(classify(project,{...empty,volumes:[{name:project+'_'+role,project:''}]}).resource_collision_free_observed).toBe(false));
it.each(['default','ittoolkit'])('blocks network %s',role=>expect(classify(project,{...empty,networks:[{name:project+'_'+role,project:''}]}).resource_collision_free_observed).toBe(false));
it('blocks project-labeled resources regardless of resource name, ignores unrelated labels',()=>{expect(classify(project,{containers:[{id,name:'other',project}],networks:[{name:'other',project}],volumes:[{name:'other',project}]}).collision_counts).toEqual({containers:1,networks:1,volumes:1});expect(classify(project,{...empty,volumes:[{name:'other',project:'other'}]}).resource_collision_free_observed).toBe(true)});
it('rejects malformed, sparse, extra fields and noncanonical project names',()=>{for(const rows of [{...empty,containers:Array(1)},{...empty,networks:[{name:'x',project:'',extra:true}]},{...empty,containers:[{id:'short',name:'x',project:''}]},{...empty,volumes:null}])expect(()=>classify(project,rows)).toThrow();for(const p of ['../x','X','x\n',''])expect(()=>classify(p,empty)).toThrow()});

const release='b'.repeat(64);
const common={'com.docker.compose.project':project,'org.aaditech.release-sha256':release};
function fixture(){
 const roles=['api','caddy','db'],volumeRoles=['agent_artifacts','api_data','caddy_config','caddy_data','mysqldata'];
 const rows={containers:roles.map((role,i)=>({id:String(i+1).repeat(64),name:project+'-'+role+'-1',project})),networks:[{name:project+'_ittoolkit',project}],volumes:volumeRoles.map(role=>({name:project+'_'+role,project}))};
 const docs={containers:rows.containers.map((r,i)=>({Id:r.id,Name:'/'+r.name,Image:'sha256:'+String(i+4).repeat(64),Config:{Labels:{...common,'com.docker.compose.service':roles[i],'org.aaditech.activation-blocked':'true'},Env:['SECRET=never-return']},State:{Status:'created',Running:false,Paused:false,Restarting:false,Dead:false},HostConfig:{PublishAllPorts:false,PortBindings:{}},NetworkSettings:{Ports:{}}})),networks:[{Id:'c'.repeat(64),Name:rows.networks[0].name,Labels:{...common,'com.docker.compose.network':'ittoolkit'},Driver:'bridge',Scope:'local',Internal:true,Attachable:false,Ingress:false,Containers:{}}],volumes:rows.volumes.map((r,i)=>({Name:r.name,Labels:{...common,'com.docker.compose.volume':volumeRoles[i]},Driver:'local',Scope:'local',Options:null,Mountpoint:'/var/lib/docker/volumes/'+r.name+'/_data'}))};
 return {rows,docs};
}
it('classifies actual exact candidate claims without exposing configuration secrets or authorizing recovery',()=>{
 const {rows,docs}=fixture(),r=recovery(project,release,rows,docs);
 expect(r).toMatchObject({shape:'ALL_CANDIDATES_CREATED',counts:{containers:3,networks:1,volumes:5},ownership_verified:false,mutation_authorized:false});
 expect(JSON.stringify(r)).not.toContain('SECRET');expect(JSON.stringify(r)).not.toContain('Env');
 for(const c of docs.containers){c.State.Status='running';c.State.Running=true;docs.networks[0].Containers[c.Id]={}}
 expect(recovery(project,release,rows,docs).shape).toBe('ALL_CONTAINERS_RUNNING');
 for(const c of docs.containers){c.State.Status='exited';c.State.Running=false}docs.networks[0].Containers={};
 expect(recovery(project,release,rows,docs).shape).toBe('ALL_CONTAINERS_EXITED');
});
it.each(['foreign label','published port','paused','foreign endpoint','external network','foreign volume','wrong release'])('flags conflicting recovery metadata: %s',reason=>{
 const {rows,docs}=fixture();
 if(reason==='foreign label')delete docs.containers[0].Config.Labels['org.aaditech.activation-blocked'];
 if(reason==='published port')docs.containers[0].HostConfig.PortBindings={'3000/tcp':[{HostPort:'3000'}]};
 if(reason==='paused'){docs.containers[0].State.Status='paused';docs.containers[0].State.Paused=true}
 if(reason==='foreign endpoint')docs.networks[0].Containers['f'.repeat(64)]={};
 if(reason==='external network')docs.networks[0].Internal=false;
 if(reason==='foreign volume')docs.volumes[0].Mountpoint='/tmp/foreign';
 if(reason==='wrong release')docs.volumes[0].Labels['org.aaditech.release-sha256']='f'.repeat(64);
 expect(recovery(project,release,rows,docs).shape).toBe('CONFLICT_OR_UNEXPECTED_RESOURCE');
});
it('distinguishes empty, resource-only and partial observed shapes',()=>{
 const {rows,docs}=fixture();
 expect(recovery(project,release,empty,empty).shape).toBe('EMPTY');
 rows.containers=[];docs.containers=[];
 expect(recovery(project,release,rows,docs).shape).toBe('RESOURCES_ONLY');
 rows.volumes.pop();docs.volumes.pop();
 expect(recovery(project,release,rows,docs).shape).toBe('PARTIAL_OR_MIXED');
});
it('rejects duplicate names and inconsistent inspection identities',()=>{
 const {rows,docs}=fixture();expect(()=>select(project,{...rows,containers:[rows.containers[0],rows.containers[0]]})).toThrow();
 docs.containers[0].Id='f'.repeat(64);expect(()=>recovery(project,release,rows,docs)).toThrow();
});
