'use strict';
// N70: reject regression to narrowed GitHub Actions safety checks, mutable
// upstream action tags or altered identity of any protected action.
const test=require('node:test');
const assert=require('node:assert/strict');
const {auditN70WorkflowBundle,readBundle}=require('../../scripts/check-phase-n70-workflow-safety.cjs');
const original=readBundle();
const safety='.github/workflows/deployment-safety.yml';
const ci='.github/workflows/ci.yml';
function deny(label,filename,replace) {
  test(label,()=>{
    const source=original[filename];
    const variant=replace(source);
    assert.notEqual(variant,source,'negative fixture did not mutate workflow');
    assert.throws(()=>auditN70WorkflowBundle({...original,[filename]:variant}),/N70 GitHub security workflow governance blocked/);
  });
}
test('current exact-pinned 4 workflows and universal two safety jobs pass',()=>{
  assert.equal(auditN70WorkflowBundle(original),true);
});
deny('disallow safety push paths narrowers',safety,s=>s.replace(
  '  push:\n    branches: [main]\n',
  "  push:\n    branches: [main]\n    paths: ['Enterprise/deploy/**']\n"
));
deny('disallow safety PR paths narrowers',safety,s=>s.replace(
  '  pull_request:\n    branches: [main]\n',
  "  pull_request:\n    branches: [main]\n    paths: ['Enterprise/deploy/**']\n"
));
deny('disallow safety PR branch narrowing',safety,s=>s.replace(
  '  pull_request:\n    branches: [main]\n',
  "  pull_request:\n    branches: ['security-only']\n"
));
deny('safety release gate cannot skip the DB job',safety,s=>s.replace(
  '  mysql-live-rehearsal:\n',
  "  mysql-live-rehearsal:\n    if: github.event_name == 'push'\n"
));
deny('safety job context must be stable',safety,s=>s.replace(
  'Isolated MySQL 8 backup and restore data integrity','MySQL optional data check'
));
deny('safety job permissions cannot become write',safety,s=>s.replace(
  'permissions:\n      contents: read', 'permissions:\n      contents: write'
));
deny('real MySQL recovery cannot be replaced by unit fixture',safety,s=>s.replaceAll(
  'Test-MySQL-Live-Rehearsal.sh','Fake-MySQL-Live-Rehearsal.sh'
));
deny('N68 live rejection regression must remain in safety job',safety,s=>s.replace(
  'bash Enterprise/tests/Test-Stage68StrictVpsAcceptance.sh',
  'echo N68 not tested'
));
deny('moving checkout tag cannot execute in CI',ci,s=>s.replace(
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/checkout@v4'
));
deny('unknown exact checkout SHA is blocked',ci,s=>s.replace(
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/checkout@'+ 'a'.repeat(40)
));
deny('workflow cannot substitute another upstream action',ci,s=>s.replace(
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'untrusted/checkout@11d5960a326750d5838078e36cf38b85af677262'
));
deny('moving setup-node action tag blocked',ci,s=>s.replace(
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/setup-node@v4'
));
deny('moving signed artifact uploader blocked',ci,s=>s.replace(
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/upload-artifact@v4'
));
deny('moving signed artifact download blocked', '.github/workflows/publish-signed-installer.yml',s=>s.replace(
  'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
  'actions/download-artifact@v4'
));
deny('project-index action pin remains immutable','.github/workflows/project-index-maintenance.yml',s=>s.replace(
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/checkout@v4'
));
deny('duplicate YAML keys are not accepted',safety,s=>s.replace(
  '  workflow_dispatch:',"  pull_request:\n    branches: [main]\n  workflow_dispatch:"
));
deny('malformed YAML does not bypass governance',safety,s=>s+'\njobs: [unclosed\n');
