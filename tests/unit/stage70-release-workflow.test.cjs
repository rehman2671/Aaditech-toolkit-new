'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {inspect,check,CMD,FIRST,PUB,TOKEN}=require('../../scripts/check-phase-n70-release-workflow.cjs');
const root=path.resolve(__dirname,'../..'),wf=path.join(root,'.github','workflows');
const ci=fs.readFileSync(path.join(wf,'ci.yml'),'utf8');
const pub=fs.readFileSync(path.join(wf,'publish-signed-installer.yml'),'utf8');
const sign=fs.readFileSync(path.join(root,'Enterprise/agent/build/Release-Sign.ps1'),'utf8');
function denied(c,p,s,label){
  assert.notDeepEqual([c,p,s],[ci,pub,sign],label+' changed fixture');
  assert.throws(()=>inspect(c,p,s),/N70 workflow bypass/,label);
}
test('current signed workflows require live protected main and a signer preflight',()=>{
  assert.equal(check(),true);
});
test('manual main preflight cannot be removed, bypassed or given another token',()=>{
  denied(ci.replace(CMD,'Write-Host accepted'),pub,sign,'preflight removed');
  denied(ci.replace(FIRST,'unrelated diagnostic step'),pub,sign,'renamed gate');
  denied(ci.replace(TOKEN,'$'+'{{ secrets.UNAPPROVED_TOKEN }}'),pub,sign,'wrong GitHub API token');
  denied(ci.replace("if: github.event_name == 'workflow_dispatch'\n        shell: pwsh\n        env:\n          GH_TOKEN",
    "if: github.event_name == 'push'\n        shell: pwsh\n        env:\n          GH_TOKEN"),
    pub,sign,'wrong event admission');
});
test('public publisher cannot bypass first or last protected-main verification',()=>{
  denied(ci,pub.replace(PUB,'untrusted publish'),sign,'publisher first gate');
  denied(ci,pub.replace(CMD,'Write-Host skip'),sign,'publisher command');
  denied(ci,pub.replace("if ($LASTEXITCODE -ne 0) { throw 'N70 live governance changed before publication.' }",
    'Write-Host ignore'),sign,'last-moment live guard');
});
test('PFX signing requires an independent read-only live admission inside the signing script',()=>{
  denied(ci,pub,sign.replace('& node $preflight --live','Write-Host accepted'),'signer');
  denied(ci,pub,sign.replace('N70 protected main preflight denied signing','N70 accept'), 'signer fail closed');
});
