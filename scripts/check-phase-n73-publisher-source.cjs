#!/usr/bin/env node
'use strict';
// N73: signed artifact must be the exact, currently protected main SHA used
// to dispatch the publication workflow. Old CI artifacts are never silently
// republished after the protected main branch advances.
const fs=require('node:fs');
const path=require('node:path');
const YAML=require('yaml');
const NAME='Validate source GitHub CI run provenance and manual confirmation';
const STAGE='Stage draft, attest hosted SHA256 digests, then publish verified GitHub Release';
const BIND="$source.head_sha -cne $env:GITHUB_SHA";
const ASSERT="if ($env:SOURCE_SHA -cne $env:GITHUB_SHA) { throw 'N73 approved signed source differs from publisher main SHA.' }";
const PREFLIGHT="node ./scripts/check-phase-n70-live-main-protection.cjs --live";
const PUBLISH="& gh release edit $env:RELEASE_TAG --draft=false --latest=false";
function fail(why){throw new Error('N73 signed-source publication bypass: '+why);}
function only(steps,name){
  const result=steps.filter(s=>s && s.name===name);
  if(result.length!==1)fail('expected exactly one '+name);
  return result[0];
}
function inspect(source){
  const doc=YAML.parseDocument(source,{uniqueKeys:true,version:'1.2'});
  if(doc.errors.length)fail('publisher YAML invalid');
  const wf=doc.toJS({maxAliasCount:0});
  const jobs=wf.jobs;
  if(!jobs||Object.keys(jobs).join(',')!=='publish')fail('publisher job changed');
  const job=jobs.publish;
  const steps=job.steps;
  if(!Array.isArray(steps)||job['continue-on-error']||
     job.if!=="github.ref == 'refs/heads/main'" ||
     job.environment!=='production-installer')fail('protected main publisher admission changed');
  const check=only(steps,NAME);
  const stage=only(steps,STAGE);
  const githubToken='$'+'{{ secrets.GITHUB_TOKEN }}';
  if(check.shell!=='pwsh'||check['continue-on-error']||check.if||check.uses||
     check.env?.GH_TOKEN!==githubToken ||
     check.env?.CI_RUN_ID!=='$'+'{{ inputs.source_run_id }}' ||
     check.env?.APPROVED_SOURCE_SHA!=='$'+'{{ inputs.approved_source_sha }}'){
    fail('approved main SHA cannot be verified from trusted CI metadata');
  }
  const admission=check.run;
  if(typeof admission!=='string' ||
     !admission.includes("$source.event -ne 'workflow_dispatch'") ||
     !admission.includes("$source.head_branch -ne 'main'") ||
     !admission.includes("$source.conclusion -ne 'success'") ||
     !admission.includes('$source.head_repository.full_name -ne $env:GITHUB_REPOSITORY') ||
     !/\$source\.head_sha -cne \$env:APPROVED_SOURCE_SHA\.ToLowerInvariant\(\) -or\s*\$source\.head_sha -cne \$env:GITHUB_SHA\) \{/.test(admission) ||
     admission.indexOf(BIND)>admission.indexOf('"SOURCE_SHA=$($source.head_sha)"')){
    fail('source run must match both human-approved SHA and publisher workflow SHA');
  }
  const script=stage.run;
  if(typeof script!=='string'||stage.shell!=='pwsh'||
     stage['continue-on-error']||stage.if||
     stage.env?.GH_TOKEN!==githubToken)fail('protected publisher step disabled');
  const first=script.indexOf(ASSERT);
  const last=script.lastIndexOf(ASSERT);
  const draft=script.indexOf('& gh release create $env:RELEASE_TAG @assets --draft');
  const n70=script.lastIndexOf(PREFLIGHT);
  const publish=script.indexOf(PUBLISH);
  if(first<0||last<=first||draft<=first||last<=n70||
     n70<=draft||publish<=last||publish<0||
     !script.includes("if ($LASTEXITCODE -ne 0) { throw 'N70 live governance changed before publication.' }")){
    fail('exact source/main binding must be verified before draft and just before publicizing');
  }
  return true;
}
function check(root=path.resolve(__dirname,'..')){
  return inspect(fs.readFileSync(path.join(root,'.github/workflows/publish-signed-installer.yml'),'utf8'));
}
if(require.main===module){
  check();
  process.stdout.write('N73 PASS: signed CI artifact exactly matches protected publisher main SHA.\n');
}
module.exports={NAME,STAGE,BIND,ASSERT,inspect,check};
