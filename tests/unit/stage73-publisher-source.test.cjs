'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {check,inspect,NAME,STAGE,BIND,ASSERT}=require('../../scripts/check-phase-n73-publisher-source.cjs');
const src=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/publish-signed-installer.yml'),'utf8');
function deny(value,label){
  assert.notEqual(value,src,label+' fixture must be modified');
  assert.throws(()=>inspect(value),/N73 signed-source publication bypass/,label);
}
test('approved signed run must share the current protected main publisher SHA',()=>{
  assert.equal(check(),true);
  assert.equal(inspect(src),true);
  assert.equal(src.split(ASSERT).length-1,2);
});
test('old signed CI run or forged manual approval cannot bypass source/main equivalence',()=>{
  deny(src.replace(BIND,'$source.head_sha -cne $env:APPROVED_SOURCE_SHA.ToLowerInvariant()'),
    'stale CI source accepted');
  deny(src.replace('$source.head_sha -cne $env:APPROVED_SOURCE_SHA.ToLowerInvariant() -or',
    '$source.head_sha -cne $env:GITHUB_SHA -or'), 'human-approved SHA ignored');
  deny(src.replace("$source.event -ne 'workflow_dispatch'","$source.event -ne 'push'"),
    'unreviewed automatic run');
  deny(src.replace("$source.head_branch -ne 'main'","$source.head_branch -ne 'feature'"),
    'non-main signed source run');
  deny(src.replace('$source.head_repository.full_name -ne $env:GITHUB_REPOSITORY',
    '$source.head_repository.full_name -eq $env:GITHUB_REPOSITORY'),'foreign source repository');
});
test('draft creation and final public release both reauthenticate source identity',()=>{
  deny(src.replace(ASSERT,'Write-Host skip'),
    'stale artifact can be staged as draft');
  const p=src.lastIndexOf(ASSERT);
  assert.ok(p>=0);
  deny(src.slice(0,p)+src.slice(p).replace(ASSERT,'Write-Host skip'),
    'stale artifact can be publicized');
  deny(src.replace(ASSERT+'\n          & gh release edit',
    '& gh release edit'), 'last main identity guard removed');
  deny(src.replace("if ($LASTEXITCODE -ne 0) { throw 'N70 live governance changed before publication.' }",
    'Write-Host ignored'),'live main SHA moved between signing and publication');
});
test('unauthorized main publisher changes and absent trusted CI inputs fail',()=>{
  deny(src.replace("if: github.ref == 'refs/heads/main'","if: github.ref == 'refs/heads/feature'"),
    'wrong target branch');
  deny(src.replace('environment: production-installer','environment: testing'),
    'missing production review');
  // Match GH_TOKEN in CI provenance, not N70's preceding preflight.
  // Neighboring CI_RUN_ID uniquely anchors this negative test mutation.
  deny(src.replace('          GH_TOKEN: $'+'{{ secrets.GITHUB_TOKEN }}\n          CI_RUN_ID:',
    '          GH_TOKEN: $'+'{{ secrets.UNTRUSTED_TOKEN }}\n          CI_RUN_ID:'),
    'wrong GH admission token');
  deny(src.replace("          CI_RUN_ID: $"+'{{ inputs.source_run_id }}',
    "          CI_RUN_ID: $"+'{{ inputs.wrong_source_run_id }}'), 'wrong source run id');
});
