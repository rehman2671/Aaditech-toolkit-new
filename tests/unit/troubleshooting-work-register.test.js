import {describe,it,expect} from 'vitest';
import {readFileSync,statSync} from 'node:fs';
import {troubleshootingCatalog} from '../../troubleshooting-policy.js';
import {diagnosticCapabilities} from '../../diagnostic-capability-catalog.js';

const read=path=>JSON.parse(readFileSync(new URL('../../docs/product/'+path,import.meta.url),'utf8'));
const tracker=read('DELIVERY-TRACKER.json'),register=read('TROUBLESHOOTING-WORK-REGISTER.json');
const parents=new Set(tracker.entries.map(e=>e.key));
const tasks=new Map(register.tasks.map(t=>[t.id,t]));
const expected=new Map();
function add(id,parent,state,requires=[]){if(expected.has(id))throw Error('duplicate expected task');expected.set(id,{parent,state,requires})}
for(const issue of troubleshootingCatalog){
 add(issue.id+'-GUIDE','M4','IMPLEMENTED_PENDING_COMBINED_CI');
 add(issue.id+'-INTAKE','M4','PENDING',[issue.id+'-GUIDE']);
 add(issue.id+'-OUTCOME','M5','PENDING',[issue.id+'-INTAKE']);
}
for(const d of diagnosticCapabilities){
 const prefix='DIAG-'+d.diagnostic_id,contract=prefix+'-CONTRACT';
 add(contract,'FE-16','IMPLEMENTED_PENDING_COMBINED_CI');
 for(const platform of ['linux','windows','macos'])
  add(prefix+'-'+platform.toUpperCase(),'PR-015',d[platform]==='NOT_IMPLEMENTED'?'PENDING':'PARTIAL_REFERENCE_ONLY',[contract]);
 add(prefix+'-CUSTODY','FE-16','PENDING',[contract]);
}
const allowedEvidence=new Set([
 'troubleshooting-guidance.js','tests/unit/troubleshooting-guidance.test.js',
 'diagnostic-evidence.js','diagnostic-review-contracts.js','tests/unit/diagnostic-review-contracts.test.js',
 'scripts/local-resource-diagnostic.mjs','tests/unit/local-resource-diagnostic.test.js',
 'scripts/local-categorical-diagnostics.mjs','tests/unit/local-categorical-diagnostics.test.js',
 'tests/unit/local-battery-diagnostic.test.js',
 'Enterprise/deploy/LocalWindowsDiagnostics.ps1','Enterprise/tests/Test-LocalWindowsDiagnostics.ps1'
]);
describe('Troubleshooting register is a traceable source-level work inventory',()=>{
 it('contains exactly the catalog-derived task identities and existing parent tracker',()=>{
  expect(tracker.production_accepted).toBe(false);expect(register.production_accepted).toBe(false);
  expect(register.parent_tracker).toBe('DELIVERY-TRACKER.json');
  expect(parents.size).toBe(tracker.entries.length);
  expect(tasks.size).toBe(register.tasks.length);
  expect([...tasks.keys()].sort()).toEqual([...expected.keys()].sort());
 });
 it('recomputes status counts without treating reference code as production acceptance',()=>{
  const counts={};
  for(const task of register.tasks)counts[task.state]=(counts[task.state]||0)+1;
  expect(counts).toEqual(register.counts);
  expect(Object.keys(counts).sort()).toEqual(['IMPLEMENTED_PENDING_COMBINED_CI','PARTIAL_REFERENCE_ONLY','PENDING']);
 });
 it('has no unknown or cyclic dependency references',()=>{
  const visiting=new Set(),done=new Set();
  function visit(id){
   expect(tasks.has(id)).toBe(true);expect(visiting.has(id)).toBe(false);
   if(done.has(id))return;
   visiting.add(id);
   for(const ref of tasks.get(id).requires||[])visit(ref);
   visiting.delete(id);done.add(id);
  }
  for(const id of tasks.keys())visit(id);
 });
 for(const [id,want] of expected){
  it(id+' preserves parent, dependency, status and evidence boundaries',()=>{
   const task=tasks.get(id);
   expect(task).toBeDefined();expect(parents.has(task.parent)).toBe(true);
   expect(task.parent).toBe(want.parent);expect(task.state).toBe(want.state);
   expect(task.requires||[]).toEqual(want.requires);
   expect(typeof task.title).toBe('string');expect(task.title.trim().length).toBeGreaterThan(0);
   if(task.state==='PENDING'){
    expect(task.evidence||[]).toEqual([]);
    expect(typeof task.acceptance).toBe('string');expect(task.acceptance.trim().length).toBeGreaterThan(0);
   }else{
    expect(Array.isArray(task.evidence)).toBe(true);expect(task.evidence.length).toBeGreaterThan(0);
    expect(new Set(task.evidence).size).toBe(task.evidence.length);
    for(const file of task.evidence){
     expect(allowedEvidence.has(file)).toBe(true);
     expect(statSync(new URL('../../'+file,import.meta.url)).isFile()).toBe(true);
    }
   }
  });
 }
});
