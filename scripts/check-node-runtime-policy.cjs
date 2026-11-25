'use strict';
const fs=require('node:fs'),path=require('node:path'),YAML=require('yaml');
const fail=()=>{throw Error('NODE_RUNTIME_POLICY_MISMATCH')};
function check({pkg,lock,docker,version,workflow}){
 if(pkg?.engines?.node!=='>=24.0.0 <25'||lock?.packages?.['']?.engines?.node!==pkg.engines.node||version!=='24\n'||!/^FROM node:24-alpine AS base$/m.test(docker)||!/^RUN npm ci --omit=dev --no-audit --no-fund$/m.test(docker)||!docker.includes("RUN node -e \"if (Number(process.versions.node.split('.')[0]) !== 24) process.exit(1)\"\nRUN npm ci"))fail();
 const parsed=YAML.parseDocument(workflow,{uniqueKeys:true});if(parsed.errors.length)fail();const wf=parsed.toJS({maxAliasCount:0});
 for(const name of ['node-tests','api-tests','offline-docker-load-rehearsal']){
  const steps=wf.jobs?.[name]?.steps;if(!Array.isArray(steps))fail();
  const setup=steps.filter(s=>String(s.uses||'').startsWith('actions/setup-node@'));
  if(setup.length!==1||setup[0].with?.['node-version']!=='24'||setup[0].if!==undefined||setup[0]['continue-on-error']!==undefined)fail();
 }
 const live=wf.jobs['api-tests'].steps.filter(s=>s.run==='bash Enterprise/tests/Run-Disposable-MySQL-Recovery-CI.sh');
 if(live.length!==1||live[0].if!==undefined||live[0].env!==undefined||live[0].shell!==undefined||live[0]['working-directory']!==undefined||live[0]['continue-on-error']!==undefined||live[0]['timeout-minutes']!==10)fail();
 const steps=wf.jobs['node-tests'].steps;
 const recovery=steps.filter(s=>s.run==='bash -n Enterprise/tests/Test-MySQL-Live-Rehearsal.sh && bash Enterprise/tests/Test-MySQL-Backup-Restore.sh');
 if(recovery.length!==1||recovery[0].if!==undefined||recovery[0].env!==undefined||recovery[0].shell!==undefined||recovery[0]['working-directory']!==undefined||recovery[0]['continue-on-error']!==undefined||recovery[0]['timeout-minutes']!==3)fail();
 const report=steps.filter(s=>s.run==='node scripts/dependency-audit-policy.cjs --report');
 const release=steps.filter(s=>s.run==='node scripts/dependency-audit-policy.cjs --release');
 const candidate=steps.filter(s=>s.run==='node scripts/prepare-dependency-upgrade-candidate.cjs');
 const tests=steps.findIndex(s=>s.run==='npm run test:coverage');
 if(candidate.length!==1||candidate[0].if!=="github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository"||candidate[0]['timeout-minutes']!==6||steps.indexOf(candidate[0])<=tests||candidate[0].env!==undefined||candidate[0].shell!==undefined||candidate[0]['working-directory']!==undefined||candidate[0]['continue-on-error']!==undefined||report.length!==1||release.length!==1||tests<0||steps.indexOf(report[0])>=tests||steps.indexOf(release[0])<=tests||
    report[0].if!==undefined||release[0].if!=="github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"||
    [report[0],release[0]].some(s=>s['continue-on-error']!==undefined||s.env!==undefined||s.shell!==undefined||s['working-directory']!==undefined||s['timeout-minutes']!==3))fail();
 return true;
}
function read(root=path.resolve(__dirname,'..')){
 const r=f=>fs.readFileSync(path.join(root,f),'utf8');
 return {pkg:JSON.parse(r('package.json')),lock:JSON.parse(r('package-lock.json')),docker:r('Dockerfile'),version:r('.node-version'),workflow:r('.github/workflows/ci.yml')};
}
if(require.main===module){try{check(read());if(Number(process.versions.node.split('.')[0])!==24)fail();console.log('PASS: Node 24 candidate runtime contract and protected dependency audit gate.')}catch{console.error('Node runtime or dependency audit policy mismatch.');process.exitCode=1}}
module.exports={check,read};
