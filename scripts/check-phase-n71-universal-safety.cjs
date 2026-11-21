#!/usr/bin/env node
'use strict';
// N71: deployment safety's two checks are REQUIRED on every PR to main.
// Guard against path-filter or job-conditional drift that silently suppresses
// the required checks on otherwise unrelated code changes.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const EXPECTED = Object.freeze({
  'mysql-backup-restore': {
    name: 'Bash syntax and offline database recovery tests',
    command: 'bash Enterprise/tests/Test-MySQL-Backup-Restore.sh'
  },
  'mysql-live-rehearsal': {
    name: 'Isolated MySQL 8 backup and restore data integrity',
    command: 'AADITECH_REHEARSAL=isolated-ci bash Enterprise/tests/Test-MySQL-Live-Rehearsal.sh'
  }
});
function ensure(ok,reason){if(!ok)throw new Error('N71 universal safety gate drift: '+reason);}
function yaml(src){
  const d=YAML.parseDocument(src,{version:'1.2',uniqueKeys:true});
  ensure(d.errors.length===0,'YAML syntax/duplicate key');
  return d.toJS({maxAliasCount:0});
}
function mainOnly(filter,label) {
  ensure(filter && typeof filter==='object' && !Array.isArray(filter),label+' event missing');
  ensure(Object.keys(filter).length===1 && Array.isArray(filter.branches) &&
    filter.branches.length===1 && filter.branches[0]==='main',
    label+' must run for ALL main commits/PRs, without paths, tags or types filters');
}
function inspect(src){
  const cfg=yaml(src);
  ensure(cfg?.name==='Deployment safety regression','workflow identity');
  const events=cfg?.on;
  ensure(events && typeof events==='object' &&
    Object.keys(events).sort().join('|')==='pull_request|push|workflow_dispatch',
    'automatic main-push/PR triggers and manual diagnostics must be retained');
  mainOnly(events.push,'main push');
  mainOnly(events.pull_request,'main-target PR');
  ensure(events.workflow_dispatch===null ||
    (typeof events.workflow_dispatch==='object' &&
     Object.keys(events.workflow_dispatch).length===0),
    'manual dispatch must not weaken safety admission');
  ensure(!cfg?.['continue-on-error'],'no workflow-level failure suppression');
  ensure(cfg.jobs && typeof cfg.jobs==='object' &&
    Object.keys(cfg.jobs).sort().join('|')===Object.keys(EXPECTED).sort().join('|'),
    'both expected safety jobs must always exist');
  for(const [id,expected] of Object.entries(EXPECTED)){
    const job=cfg.jobs[id];
    ensure(job.name===expected.name,'exact required GitHub status context '+id);
    ensure(job['runs-on']==='ubuntu-latest','isolated Linux runner '+id);
    ensure(!Object.prototype.hasOwnProperty.call(job,'if'),'job must never be conditionally skipped '+id);
    ensure(!job['continue-on-error'],'failure must block required context '+id);
    ensure(job.permissions?.contents==='read' &&
      Object.keys(job.permissions).length===1,'read-only job permissions '+id);
    ensure(Array.isArray(job.steps)&&job.steps.length>0,'nonempty executable steps '+id);
    ensure(job.steps.some(s=>typeof s?.run==='string' &&
      s.run.includes(expected.command)),'real safety command missing '+id);
  }
  return true;
}
function check(root=path.resolve(__dirname,'..')){
  return inspect(fs.readFileSync(path.join(root,'.github/workflows/deployment-safety.yml'),'utf8'));
}
if(require.main===module){
  check();
  process.stdout.write('N71 PASS: required safety checks run on every main PR and main push.\n');
}
module.exports={EXPECTED,inspect,check};
