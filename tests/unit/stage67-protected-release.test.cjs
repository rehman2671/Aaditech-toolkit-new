'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MAIN_BUILD, inspectCI, inspectPublisher, checkAll } = require(
  '../../scripts/check-phase-n67-release-workflow.cjs');
const root = path.resolve(__dirname, '../..', '.github', 'workflows');
const ci = fs.readFileSync(path.join(root, 'ci.yml'), 'utf8');
const pub = fs.readFileSync(path.join(root, 'publish-signed-installer.yml'), 'utf8');
function deny(original, changed, inspect, label) {
  assert.notEqual(changed, original, label + ': fixture did not change');
  assert.throws(() => inspect(changed), /N67 /, label);
}
test('both current protected workflows enforce N67 security policy', () => {
  assert.deepEqual(checkAll(), { ci: 'protected', publisher: 'protected' });
});
test('non-main manual signing access fails closed', () => {
  deny(ci, ci.replace(MAIN_BUILD,
    "github.event_name == 'workflow_dispatch' || github.event_name == 'push'"),
    inspectCI, 'main-only job');
  deny(ci, ci.replace("'production-installer' || 'ci-diagnostic'",
    "'ci-diagnostic' || 'ci-diagnostic'"), inspectCI, 'review environment');
});
test('dropping API gate or independent package approval fails closed', () => {
  deny(ci, ci.replace('needs: [powershell-validation, node-tests, api-tests]', 'needs: [powershell-validation, node-tests]'),
    inspectCI, 'API gate');
  deny(ci, ci.replace(
    'Install-ApprovedCompiler.ps1 -Kind ps2exe',
    'Install-Module -Name ps2exe -Force'), inspectCI, 'N63 approval');
  deny(ci, ci.replace(
    "if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    "if: github.event_name == 'workflow_dispatch'"), inspectCI, 'N63 manual branch');
});
test('protected sign/receipt commands cannot be replaced by no-op', () => {
  for (const needle of [
    './Enterprise/agent/build/Release-Sign.ps1 -Stage PrePackage',
    './Enterprise/agent/build/Release-Sign.ps1 -Stage Finalize',
    './Enterprise/agent/build/Verify-SignedPublication.ps1',
    './Enterprise/agent/build/Write-SourceReleaseApprovalReceipt.ps1'
  ]) deny(ci, ci.replace(needle, 'Write-Host accepted'), inspectCI, needle);
});
test('unsigned artifact upload condition or wrong publisher key fails closed', () => {
  deny(ci, ci.replace(
    "env.PUBLISH_SIGNED == 'true' && env.PUBLICATION_VERIFIED == 'true' && env.RELEASE_APPROVAL_RECEIPT_VERIFIED == 'true'",
    "env.PUBLISH_SIGNED == 'true'"), inspectCI, 'unsigned upload');
  deny(ci, ci.replace('secrets.CODESIGN_PFX_B64',
    'secrets.UNAPPROVED_PFX_B64'), inspectCI, 'unapproved publisher key');
});
test('publisher cannot run on another branch or skip human environment', () => {
  deny(pub, pub.replace("if: github.ref == 'refs/heads/main'",
    'if: always()'), inspectPublisher, 'publisher branch');
  deny(pub, pub.replace('environment: production-installer',
    'environment: ci-diagnostic'), inspectPublisher, 'publisher approval');
});
test('publisher cannot use different source checkout or artifact run', () => {
  deny(pub, pub.replace('ref: $' + '{{ env.SOURCE_SHA }}', 'ref: main'),
    inspectPublisher, 'source checkout');
  deny(pub, pub.replace('run-id: $' + '{{ inputs.source_run_id }}',
    'run-id: 123456'), inspectPublisher, 'artifact run mismatch');
});
test('reviewer approval and real signature checks must execute', () => {
  deny(pub, pub.replace(
    './Enterprise/agent/build/Assert-PublicationReviewerApproval.ps1 -ArtifactDir release',
    'Write-Host approved -ArtifactDir release'),
    inspectPublisher, 'independent reviewer');
  deny(pub, pub.replace(
    './Enterprise/agent/build/Verify-ReleaseArtifact.ps1 -ArtifactDir release',
    'Write-Host verified -ArtifactDir release'),
    inspectPublisher, 'signed MSI identity');
});
test('private draft, hosted pre/post attestation cannot be bypassed', () => {
  deny(pub, pub.replace('--draft --target $env:SOURCE_SHA',
    '--target $env:SOURCE_SHA'), inspectPublisher, 'private draft');
  deny(pub, pub.replace('gh release edit $env:RELEASE_TAG --draft=false --latest=false',
    'gh release edit $env:RELEASE_TAG --latest=false'), inspectPublisher, 'public gate');
  deny(pub, pub.replace(
    'Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequirePublished',
    'Write-Host published'), inspectPublisher, 'postpublish hosted check');
});
