'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspect, check, CONDITION } = require('../../scripts/check-phase-n68-pr-diagnostic-msi.cjs');
const ci = fs.readFileSync(path.join(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
const marker = '\n  agent-diagnostic-pr:\n';
function reject(modifier, label) {
  const pivot = ci.indexOf(marker);
  assert.ok(pivot > 0, 'PR diagnostic job absent');
  const before = ci.slice(0, pivot);
  const after = ci.slice(pivot);
  const changed = modifier(after);
  assert.notEqual(changed, after, label + ': fixture unchanged');
  assert.throws(() => inspect(before + changed), /N68 /, label);
}
test('checked-in premerge Windows MSI diagnostic safety gate', () => {
  assert.deepEqual(check(), { checkedSteps: 12, comparedWindowsSteps: 4 });
});
test('PR job cannot run for forks, arbitrary branches or main push', () => {
  reject(s => s.replace(CONDITION, "github.event_name == 'pull_request'"),
    'fork and arbitrary PR');
  reject(s => s.replace("startsWith(github.head_ref, 'integration/')", 'true'),
    'non-integration branch');
});
test('PR job cannot access signing environment or write permissions', () => {
  reject(s => s.replace('permissions:\n      contents: read',
    'environment: production-installer\n    permissions:\n      contents: read'),
    'protected signing environment');
  reject(s => s.replace('contents: read', 'contents: write'), 'write token');
  reject(s => s.replace('needs: [powershell-validation, node-tests, api-tests]',
    'needs: [node-tests]'), 'missing prerequisite');
});
test('replaced build command and non-pin toolchain are blocked', () => {
  reject(s => s.replace('Install-Module -Name ps2exe -RequiredVersion 1.0.18',
    'Install-Module -Name ps2exe'), 'floating compiler');
  reject(s => s.replace('dotnet tool install --global wix --version 5.0.2',
    'dotnet tool install --global wix'), 'floating MSI packager');
  reject(s => s.replace('./Enterprise/agent/wix/build-msi.ps1', 'Write-Host msi'),
    'skipped MSI build');
});
test('signed build mode, removal of unsigned checks and uploads are rejected', () => {
  reject(s => s.replace("RELEASE_SIGNING_ENABLED -cne 'false'", "RELEASE_SIGNING_ENABLED -cne 'true'"),
    'signing mode');
  reject(s => s.replace('Get-AuthenticodeSignature', 'Write-Host'),
    'unsigned signature assertion');
  reject(s => s + '\n      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n',
    'artifact upload');
  reject(s => s.replace('CODESIGN_PFX_B64', 'signing_key_removed'),
    'signing credential admission');
});
test('preview cannot drop GUI install, uninstall or major-upgrade rehearsal', () => {
  reject(s => s.replace('./Enterprise/tests/Test-Windows-MsiInstall.ps1',
    'Write-Host noop'), 'no install');
  reject(s => s.replace('./Enterprise/tests/Test-Windows-MsiUpgrade.ps1',
    'Write-Host noop'), 'no upgrade');
  reject(s => s.replace("if (-not $cfg.needs_setup -or $cfg.endpoint",
    "if (-not $cfg.needs_setup -and $cfg.endpoint"), 'endpoint extraction assertion');
});
