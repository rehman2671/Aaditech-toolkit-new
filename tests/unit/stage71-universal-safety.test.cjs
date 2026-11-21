'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {check,inspect,EXPECTED}=require('../../scripts/check-phase-n71-universal-safety.cjs');
const src=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/deployment-safety.yml'),'utf8');
function deny(replaced,label){
  assert.notEqual(replaced,src,label+' fixture changed');
  assert.throws(()=>inspect(replaced),/N71 universal safety gate drift/,label);
}
test('both real main PR and main push safety checks execute unconditionally',()=>{
  assert.equal(check(),true);
  assert.equal(inspect(src),true);
  assert.equal(Object.keys(EXPECTED).length,2);
});
test('path filters on either trigger would leave required status checks missing',()=>{
  deny(src.replace('  pull_request:\n    branches: [main]',
    "  pull_request:\n    branches: [main]\n    paths:\n      - 'Enterprise/deploy/**'"),'PR path restriction');
  deny(src.replace('  push:\n    branches: [main]',
    "  push:\n    branches: [main]\n    paths-ignore:\n      - '*.md'"),'main push path-ignore');
  deny(src.replace('  push:\n    branches: [main]',
    "  push:\n    branches: [main]\n    paths:\n      - 'Enterprise/deploy/**'"),'main push paths');
});
test('required safety checks may not be narrowed to another target or event type',()=>{
  deny(src.replace('  pull_request:\n    branches: [main]',
    '  pull_request:\n    branches: [release]'),'wrong PR target');
  deny(src.replace('  pull_request:\n    branches: [main]',
    '  pull_request:\n    branches: [main]\n    types: [closed]'),'closed event only');
  deny(src.replace('  pull_request:\n    branches: [main]',
    '  pull_request_target:\n    branches: [main]'),'privileged fork PR trigger');
});
test('neither mandatory check may be renamed, made optional or hidden behind a job condition',()=>{
  deny(src.replace('name: Bash syntax and offline database recovery tests',
    'name: Offline checks only'),'changed check context');
  deny(src.replace('name: Isolated MySQL 8 backup and restore data integrity',
    'name: MySQL migration'), 'changed DB check context');
  deny(src.replace('  mysql-live-rehearsal:\n',
    '  mysql-live-rehearsal:\n    if: github.event_name == \'workflow_dispatch\'\n'),
  'manually gated DB job');
  deny(src.replace('  mysql-backup-restore:\n',
    '  mysql-backup-restore:\n    continue-on-error: true\n'),'optional Bash gate');
});
test('real backup/restore execution and read-only job permissions are mandatory',()=>{
  deny(src.replace('run: bash Enterprise/tests/Test-MySQL-Backup-Restore.sh',
    'run: echo done'),'backup removed');
  deny(src.replace('AADITECH_REHEARSAL=isolated-ci bash Enterprise/tests/Test-MySQL-Live-Rehearsal.sh',
    'echo success'),'database rehearsal removed');
  deny(src.replace('      contents: read','      contents: write'),'excess token permissions');
});
