'use strict';
// N69 fail-closed negative fixtures for real CI YAML, no network or signing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { auditN69CIWorkflow, WORKFLOW } = require('../../scripts/check-phase-n69-ci-release-gates.cjs');
const source = fs.readFileSync(WORKFLOW, 'utf8');

function deny(name, transform) {
  test(name, () => {
    const variant = transform(source);
    assert.notEqual(variant, source, 'negative fixture failed to mutate source');
    assert.throws(() => auditN69CIWorkflow(variant), /N69 CI release gate blocked/);
  });
}
test('actual locked CI and security-signing dependencies pass', () => {
  assert.equal(auditN69CIWorkflow(source), true);
});
deny('removed Windows validation prerequisite cannot sign an MSI', s =>
  s.replace('needs: [powershell-validation, node-tests, api-tests, offline-docker-load-rehearsal]', 'needs: [node-tests, api-tests]'));
deny('replaced Windows prerequisite with a different job cannot sign', s =>
  s.replace('needs: [powershell-validation, node-tests, api-tests, offline-docker-load-rehearsal]', 'needs: [node-tests, api-tests, another-job]'));
deny('PowerShell security job cannot become conditional', s =>
  s.replace('  powershell-validation:\n', "  powershell-validation:\n    if: github.event_name == 'push'\n"));
deny('npm install fallback in Node unit tests is blocked', s =>
  s.replace('run: npm ci', 'run: npm ci || npm install'));
deny('npm install fallback in API tests is blocked', s => {
  const first = s.indexOf('run: npm ci');
  const second = s.indexOf('run: npm ci', first + 1);
  assert.ok(second > first);
  return s.slice(0, second) + 'run: npm ci || npm install' + s.slice(second + 'run: npm ci'.length);
});
deny('release environment cannot be changed to unprotected diagnostic', s =>
  s.replace("'production-installer' || 'ci-diagnostic'", "'ci-diagnostic' || 'ci-diagnostic'"));
deny('manual signing event boundary may not be widened to PR', s =>
  s.replace("if: github.event_name == 'workflow_dispatch' || github.event_name == 'push'",
            "if: github.event_name == 'workflow_dispatch' || github.event_name == 'push' || github.event_name == 'pull_request'"));
deny('signed uploads cannot skip reviewer receipt gate', s =>
  s.replace("&& env.RELEASE_APPROVAL_RECEIPT_VERIFIED == 'true'", ''));
deny('Windows signer Pester regressions cannot be silently removed', s =>
  s.replace('N67 reject provisioned/ambiguous signed-release config JSON (PowerShell 7)', 'N67 tests removed'));
deny('malformed YAML cannot bypass checks', s => s + '\n  unexpected: [unterminated\n');
