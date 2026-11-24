import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const worker = readFileSync(new URL('../../Enterprise/agent/Agent-Collect.ps1', import.meta.url), 'utf8');

describe('P0 automatic MSI self-update has no release approval bypass', () => {
  it('refuses unsigned/unpinned MSI download or elevated execution', () => {
    expect(worker).toContain('function Update-AgentIfNeeded');
    expect(worker).toContain('AUTO_UPDATE_RELEASE_APPROVAL_REQUIRED');
    expect(worker).not.toMatch(/Start-Process\s+msiexec/i);
    expect(worker).not.toMatch(/Invoke-WebRequest|IT-Toolkit-Agent-update\.msi/i);
    expect(worker).not.toContain("Request-ElevatedJob -Action 'update'");
  });
});
