import {describe,it,expect} from 'vitest';
import {buildTroubleshootingHelp,registerTroubleshootingHelpRoutes} from '../../troubleshooting-help-routes.js';
import {employeeGuidanceCatalog} from '../../troubleshooting-guidance.js';
describe('portal help contract',()=>{
 for(const issue of employeeGuidanceCatalog)it('advisory '+issue.id,()=>{
  const r=buildTroubleshootingHelp({category_id:issue.id,hazard:'NONE',platform:'windows'});
  expect(r.guidance.title).toBe(issue.title);expect(r.incident_created).toBe(false);expect(r.execution_authorized).toBe(false);
  expect(r.capability===null).toBe(issue.repair_tier==='D3');
 });
 for(const hazard of ['UNKNOWN','PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE'])it('hazard '+hazard,()=>{
  expect(buildTroubleshootingHelp({category_id:'TR-01',hazard,platform:'windows'}).capability).toBeNull();
 });
 it('rejects unknown keys and repeated parameters',()=>{
  for(const patch of [{tenant_id:'x'},{hazard:['NONE','UNKNOWN']},{platform:'other'},{category_id:'TR-99'}])expect(()=>buildTroubleshootingHelp({category_id:'TR-01',hazard:'NONE',platform:'windows',...patch})).toThrow('INVALID_HELP_QUERY');
 });
 it('routes require principal and prevent caching',()=>{
  const routes={};registerTroubleshootingHelpRoutes({get:(p,f)=>routes[p]=f});
  const res=()=>({headers:{},code:200,body:null,set(k,v){this.headers[k]=v;return this},status(c){this.code=c;return this},json(b){this.body=b;return this}});
  for(const handler of Object.values(routes)){const r=res();handler({query:{}},r);expect(r.code).toBe(401);expect(r.headers['Cache-Control']).toBe('no-store')}
  const r=res();routes['/api/v1/troubleshooting/catalog']({user:{tenant_id:'t'},query:{}},r);expect(r.body.categories).toHaveLength(26);
  const bad=res();routes['/api/v1/troubleshooting/catalog']({user:{tenant_id:'t'},query:{tenant_id:'other'}},bad);expect(bad.code).toBe(400);
 });
});
