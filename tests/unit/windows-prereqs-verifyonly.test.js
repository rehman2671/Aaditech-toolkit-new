import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../Enterprise/deploy/Install-Prereqs.ps1', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

describe('Windows prerequisite VerifyOnly must be non-mutating', () => {
  it('never automatically downgrades PowerShell execution policy in any mode', () => {
    expect(source).not.toMatch(/\bSet-ExecutionPolicy\b/);
    expect(source).toContain("$cur = Get-ExecutionPolicy");
    expect(source).toContain("$policyReviewRequired");
    expect(source).toContain("if (-not $VerifyOnly) {");
    expect(source).toContain("exit 3");
  });
  it('does not require privilege to inventory, or run feature mutation in a non-admin inventory', () => {
    expect(source).toContain("if (-not $elevated -and -not $VerifyOnly)");
    expect(source).toContain("if (-not $elevated -and $VerifyOnly)");
    expect(source).toContain("if ($VerifyOnly -and -not $elevated)");
    expect(source).toContain("WSL2/VirtualMachinePlatform feature state NOT VERIFIED");
  });
  it('guards winget from accidental invocation in VerifyOnly and fails unverified readiness', () => {
    expect(source).toContain("if ($VerifyOnly) { throw 'READ_ONLY_VERIFY_MODE:");
    expect(source).toContain("if ($stillMissing.Count -gt 0 -or $policyReviewRequired");
    expect(workflow).toContain('Test Windows prerequisite dry-run never changes execution policy');
    expect(workflow).toContain('Test-PrereqsVerifyOnly.ps1');
  });
});
