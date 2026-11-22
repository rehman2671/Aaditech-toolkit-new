'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {inspect,check,CMD,FIRST,PUB,TOKEN}=require('../../scripts/check-phase-n71-release-workflow.cjs');
const root=path.resolve(__dirname,'../..'),wf=path.join(root,'.github','workflows');
const ci=fs.readFileSync(path.join(wf,'ci.yml'),'utf8');
const pub=fs.readFileSync(path.join(wf,'publish-signed-installer.yml'),'utf8');
const sign=fs.readFileSync(path.join(root,'Enterprise/agent/build/Release-Sign.ps1'),'utf8');
function denied(c,p,s,label){
  assert.notDeepEqual([c,p,s],[ci,pub,sign],label+' changed fixture');
  assert.throws(()=>inspect(c,p,s),/N71 workflow bypass/,label);
}
test('current signed workflows require live protected main and a signer preflight',()=>{
  assert.equal(check(),true);
});
test('manual main preflight cannot be removed, bypassed or given another token',()=>{
  denied(ci.replace(CMD,'Write-Host accepted'),pub,sign,'preflight removed');
  denied(ci.replace(FIRST,'unrelated diagnostic step'),pub,sign,'renamed gate');
  denied(ci.replace(TOKEN,'$'+'{{ secrets.UNAPPROVED_TOKEN }}'),pub,sign,'wrong GitHub API token');
  denied(ci.replace("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'\n        shell: pwsh\n        env:\n          GH_TOKEN",
    "if: github.event_name == 'push'\n        shell: pwsh\n        env:\n          GH_TOKEN"),
    pub,sign,'wrong event admission');
});
test('public publisher cannot bypass first or last protected-main verification',()=>{
  denied(ci,pub.replace(PUB,'untrusted publish'),sign,'publisher first gate');
  denied(ci,pub.replace(CMD,'Write-Host skip'),sign,'publisher command');
  denied(ci,pub.replace("if ($LASTEXITCODE -ne 0) { throw 'N71 live governance changed before publication.' }",
    'Write-Host ignore'),sign,'last-moment live guard');
});
test('signer validates fingerprint locally, then live main before PFX access',()=>{
  denied(ci,pub,sign.replace('& node $preflight --live','Write-Host accepted'),'signer');
  denied(ci,pub,sign.replace('N71 protected main preflight denied signing','N71 accept'), 'signer fail closed');
  const check="if ($expected -cnotmatch '^[A-F0-9]{40}$')";
  denied(ci,pub,sign.replace(check,'if ($false)'), 'removed thumbprint admission');
  const first = sign.indexOf('$expected = (');
  const local = sign.indexOf(check);
  const live = sign.indexOf('& node $preflight --live');
  const pfx = sign.indexOf('[Convert]::FromBase64String');
  assert.ok(first >= 0 && first < local && local < live && live < pfx,
    'local fingerprint rejection precedes live governance, both before PFX');
});

test('publisher cannot release stale historical approved SHA',()=>{
  denied(ci,pub.replace('$source.head_sha -cne $env:GITHUB_SHA','Write-Host ignore-stale-source'),sign,'source provenance current-main binding');
  denied(ci,pub.replace("if ($env:SOURCE_SHA -cne $env:GITHUB_SHA)",'Write-Host skip-source-pin'),sign,'missing pre-draft source pin');
  const needle="if ($env:SOURCE_SHA -cne $env:GITHUB_SHA)";
  const first=pub.indexOf(needle),last=pub.lastIndexOf(needle);
  assert.ok(last>first);
  denied(ci,pub.slice(0,last)+pub.slice(last).replace(needle,'Write-Host skip-source-pin'),sign,'missing pre-publication source pin');
});
test('both protected signing stages require manual GitHub API token',()=>{
  const needle="GH_TOKEN: " + '$' + "{{ github.event_name == 'workflow_dispatch' && secrets.GITHUB_TOKEN || '' }}";
  assert.equal(ci.split(needle).length-1,2,'expected token on exactly two signing calls');
  denied(ci.replace(needle,"GH_TOKEN: " + '$' + "{{ secrets.UNTRUSTED_TOKEN }}"),pub,sign,'signing token substitution');
});
