#!/usr/bin/env node
'use strict';
// N72: CI must use frozen dependency tree, never fall back from failed npm ci
// to non-frozen npm install. This tool is executed in npm run lint.
const fs=require('node:fs');
const path=require('node:path');
const YAML=require('yaml');
const REQUIRED=Object.freeze({
  'node-tests':'Node.js Unit & Integration Tests (Vitest + MySQL 8)',
  'api-tests':'API test suite (Node.js vs MySQL 8)'
});
function fail(reason){throw new Error('N72 unfrozen CI dependencies: '+reason);}
function asYaml(src){
  const d=YAML.parseDocument(src,{version:'1.2',uniqueKeys:true});
  if(d.errors.length)fail('malformed CI YAML');
  return d.toJS({maxAliasCount:0});
}
function canonical(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
}
function inspect(ciText,packageText,lockText){
  const wf=asYaml(ciText);
  let pkg,lock;
  try{pkg=JSON.parse(packageText);lock=JSON.parse(lockText);}
  catch{fail('invalid package or lock JSON');}
  if(!pkg||!lock||lock.lockfileVersion!==3 ||
    !lock.packages||!lock.packages['']||
    lock.packages[''].name!==pkg.name ||
    lock.packages[''].version!==pkg.version ||
    canonical(lock.packages[''].dependencies||{})!==canonical(pkg.dependencies||{}) ||
    canonical(lock.packages[''].devDependencies||{})!==canonical(pkg.devDependencies||{})){
    fail('package.json and committed package-lock root metadata differ');
  }
  if(!wf?.jobs||typeof wf.jobs!=='object')fail('CI jobs missing');
  for(const [id,name] of Object.entries(REQUIRED)){
    const job=wf.jobs[id];
    if(!job||job.name!==name||!Array.isArray(job.steps)||job['continue-on-error'] ||
      Object.prototype.hasOwnProperty.call(job,'if') ||
      job.defaults?.run?.['working-directory'])fail('mandatory test job was weakened: '+id);
    const installs=job.steps.map((step,index)=>({step,index}))
      .filter(x=>x.step?.name==='Install dependencies');
    if(installs.length!==1)fail('expected exactly one dependency install step: '+id);
    const {step,index}=installs[0];
    if(step.run?.trim()!=='npm ci' ||
      Object.prototype.hasOwnProperty.call(step,'if') ||
      step['continue-on-error'] ||
      step['working-directory'] || step.uses ||
      step.shell && step.shell!=='bash'){
      fail('only unconditionally executed npm ci is permitted: '+id);
    }
    const checkout=job.steps.findIndex(s=>typeof s?.uses==='string' &&
      s.uses.startsWith('actions/checkout@'));
    const node=job.steps.findIndex(s=>typeof s?.uses==='string' &&
      s.uses.startsWith('actions/setup-node@'));
    if(checkout<0||node<0||index<=checkout||index<=node){
      fail('install must follow checkout and pinned Node setup: '+id);
    }
  }
  return true;
}
function check(root=path.resolve(__dirname,'..')){
  return inspect(fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'),
    fs.readFileSync(path.join(root,'package.json'),'utf8'),
    fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
}
if(require.main===module){
  check();
  process.stdout.write('N72 PASS: Node/API CI use only frozen npm ci and lockfile root matches.\n');
}
module.exports={REQUIRED,inspect,check};
