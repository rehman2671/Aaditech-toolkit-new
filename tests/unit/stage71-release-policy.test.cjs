'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {checkN71ReleasePolicy,readN71Bundle}=require('../../scripts/check-phase-n71-release-policy.cjs');
const source=readN71Bundle();
function deny(label,slot,mutate){
  test(label,()=>{
    const next=source.slice();
    next[slot]=mutate(next[slot]);
    assert.notEqual(next[slot],source[slot],'negative fixture failed to change file');
    assert.throws(()=>checkN71ReleasePolicy(...next),/N71 protected-release governance workflow blocked/);
  });
}
test('real protected signer and publisher each contain live pre-sign and pre-publication gates',()=>{
  assert.equal(checkN71ReleasePolicy(...source),true);
});
deny('manual pre-compiler live protection guard cannot be removed',0,s=>
  s.replace('N71 verify live protected main ruleset before approved compiler download','N71 preflight removed'));
deny('manual pre-compiler guard cannot be unconditionally skipped',0,s=>
  s.replace("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
            "if: github.event_name == 'push'"));
deny('signer stage cannot run without GitHub token',0,s=>
  s.replace("GH_TOKEN: \${{ github.event_name == 'workflow_dispatch' && secrets.GITHUB_TOKEN || '' }}",
            'GH_TOKEN: disabled'));
deny('MSI finalize signer must recheck same ruleset',0,s=>
  s.replace('Verify pre-signed MSI payload and sign release MSI','MSI finalize without N71'));
deny('publisher preflight cannot be removed',1,s=>
  s.replace('N71 verify live main ruleset before accepting signed publication','N71 publisher protection skipped'));
deny('publisher first live check must be active',1,s=>
  s.replace('run: node ./scripts/check-phase-n71-live-release-governance.cjs --live',
            'run: echo protected main ok'));
deny('publisher may not accept stale signed source SHA',1,s=>
  s.replace('$source.head_sha -cne $env:GITHUB_SHA',' $source.head_sha -cne $env:APPROVED_SOURCE_SHA'));
deny('publisher must recheck before draft',1,s=>
  s.replace("if ($LASTEXITCODE -ne 0) { throw 'N71 main governance changed before draft staging.' }",
            "if ($LASTEXITCODE -ne 0) { Write-Host 'Ignored' }"));
deny('publisher must recheck just before making draft public',1,s=>
  s.replace("if ($LASTEXITCODE -ne 0) { throw 'N71 live branch protection changed before publication.' }",
            "if ($LASTEXITCODE -ne 0) { Write-Host 'Ignored' }"));
deny('publisher must not use diagnostic environment',1,s=>
  s.replace('environment: production-installer','environment: ci-diagnostic'));
deny('release sign tool cannot skip live branch policy',2,s=>
  s.replace('& node $liveGuard --live','Write-Host "Skip live governance"'));
deny('release sign must verify branch before PFX decryption',2,s=>
  s.replace('& node $liveGuard --live','& node $liveGuard --live # after?'));
deny('invalid publisher YAML cannot bypass policy',1,s=>s+'\nnew-unclosed: [');
