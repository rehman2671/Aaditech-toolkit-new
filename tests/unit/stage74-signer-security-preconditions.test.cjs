'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {check,inspect,REQUIRED}=require('../../scripts/check-phase-n74-signer-security-preconditions.cjs');
const src=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/ci.yml'),'utf8');
const exact='    needs: [powershell-validation, node-tests, api-tests]';
function deny(next,label){
  assert.notEqual(next,src,label+' fixture must change');
  assert.throws(()=>inspect(next),/N74 signer prerequisite bypass/,label);
}
test('all mandatory Windows, Node and API suites must succeed before signing',()=>{
  assert.equal(check(),true);
  assert.equal(inspect(src),true);
  assert.equal(Object.keys(REQUIRED).length,3);
  assert.ok(src.includes(exact), 'three-check dependency is declared');
});
test('dropping or duplicating a signer dependency is rejected',()=>{
  deny(src.replace(exact,'    needs: [node-tests, api-tests]'),'missing Windows');
  deny(src.replace(exact,'    needs: [powershell-validation, api-tests]'),'missing Node');
  deny(src.replace(exact,'    needs: [powershell-validation, node-tests]'),'missing API');
  deny(src.replace(exact,'    needs: [powershell-validation, node-tests, node-tests]'),'duplicate');
});
test('required security checks cannot be optional, renamed, or skipped',()=>{
  deny(src.replace('  powershell-validation:\n','  powershell-validation:\n    if: false\n'),'Windows skipped');
  deny(src.replace('  node-tests:\n','  node-tests:\n    continue-on-error: true\n'),'Node optional');
  deny(src.replace('  api-tests:\n','  api-tests:\n    if: always()\n'),'API optional');
  deny(src.replace('    name: PowerShell validation','    name: PowerShell warnings only'),'check renamed');
});
test('production main restrictions, protected environment and N70 cannot weaken',()=>{
  deny(src.replace(exact,exact+'\n    continue-on-error: true'),'signer optional');
  deny(src.replace("if: (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || (github.event_name == 'push' && github.ref == 'refs/heads/main')",
    'if: always()'),'signer always');
  deny(src.replace("name: $"+ "{{ github.event_name == 'workflow_dispatch' && 'production-installer' || 'ci-diagnostic' }}",
    'name: ci-diagnostic'),'protected environment removed');
  deny(src.replace('        run: node ./scripts/check-phase-n70-live-main-protection.cjs --live',
    '        run: echo skip'),'N70 gate removed');
});
