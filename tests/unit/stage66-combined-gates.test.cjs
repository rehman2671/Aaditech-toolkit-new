'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCombined, inspectCombinedCI } = require('../../scripts/check-phase-n64-n65-integration.cjs');

const windows = [
  { name: 'N64 verify full SHA-approved PS2EXE payload across protected build steps (PowerShell 7)',
    run: 'pwsh -NoProfile -File ./Enterprise/tests/Test-Stage64ApprovedCompilerPayload.ps1' },
  { name: 'N64 reject copied compiler code tampering on Windows PowerShell 5.1',
    shell: 'powershell', run: './Enterprise/tests/Test-Stage64ApprovedCompilerPayload.ps1' }
];
const protectedNames = [
  'N63 install independently SHA-approved PS2EXE NUPKG (protected manual only)',
  'N63 install independently SHA-approved WiX NUPKG (protected manual only)',
  'Sign release EXE before WiX embeds it (or keep diagnostic only)',
  'Verify pre-signed MSI payload and sign release MSI',
  'Verify final signed artifact publication'
];
function fixture() {
  const psSteps = windows.map(s => '      - name: ' + s.name + '\n' +
    (s.shell ? '        shell: ' + s.shell + '\n' : '') +
    '        run: ' + s.run).join('\n');
  const releaseSteps = protectedNames.map(s => '      - name: ' + s + '\n        run: echo checked').join('\n');
  return 'jobs:\n  powershell-validation:\n    runs-on: windows-latest\n    steps:\n' +
    psSteps + '\n  agent-build:\n    runs-on: windows-latest\n' +
    "    if: \${{ github.event_name == 'workflow_dispatch' || github.event_name == 'push' }}\n" +
    "    environment:\n      name: \${{ github.event_name == 'workflow_dispatch' && 'production-installer' || 'ci-diagnostic' }}\n" +
    '    steps:\n' + releaseSteps + '\n';
}
test('full checked-in N64+N65 build identity and test gates', () => {
  const result = checkCombined();
  assert.equal(result.n64Tests, 2);
  assert.equal(result.protectedSteps, 5);
  assert.ok(result.actionCount >= 13);
});
test('synthetic protected CI wiring accepted', () => {
  assert.equal(inspectCombinedCI(fixture()).n64Tests, 2);
});
test('dropping the PowerShell 5.1 N64 test is rejected', () => {
  const broken = fixture().replace(
    '      - name: ' + windows[1].name + '\n        shell: powershell\n        run: ' + windows[1].run + '\n', '');
  assert.throws(() => inspectCombinedCI(broken), /N66 N64 compiler payload test/);
});
test('PowerShell 5.1 test silently switched to pwsh is rejected', () => {
  const broken = fixture().replace('shell: powershell', 'shell: pwsh');
  assert.throws(() => inspectCombinedCI(broken), /N66 N64 compiler payload test/);
});
test('protected MSI publication gate cannot disappear during combined merge', () => {
  const broken = fixture().replace(
    '      - name: ' + protectedNames[4] + '\n        run: echo checked\n', '');
  assert.throws(() => inspectCombinedCI(broken), /N66 protected packaging gate/);
});
test('diagnostic-only environment or disabled dispatch is rejected', () => {
  assert.throws(() => inspectCombinedCI(fixture().replace(
    "'production-installer'", "'ci-diagnostic'")), /N66 protected build/);
  assert.throws(() => inspectCombinedCI(fixture().replace(
    "github.event_name == 'workflow_dispatch' || ", '')), /N66 protected build/);
});
