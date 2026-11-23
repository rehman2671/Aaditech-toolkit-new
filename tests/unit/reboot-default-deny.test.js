import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const agent = readFileSync(new URL('../../Enterprise/agent/Agent-Collect.ps1', import.meta.url), 'utf8');

describe('P0 signed-command transport cannot become unauthorized reboot approval', () => {
  it('no longer executes or stages Windows reboot in either worker or elevated pass', () => {
    expect(agent).toContain("'reboot' {");
    expect(agent).toContain('REBOOT_APPROVAL_REQUIRED');
    expect(agent).toContain("status = 'failed'");
    expect(agent).toContain('exit_code = 403');
    expect(agent).not.toMatch(/Restart-Computer|shutdown\.exe/i);
    expect(agent).not.toContain("Request-ElevatedJob -Action 'reboot'");
    expect(agent).not.toContain("if ($job.action -eq 'reboot')");
  });
  it('does not accept reboot as an unsigned elevated-task file action', () => {
    expect(agent).toContain("if ($Action -eq 'reboot')");
    expect(agent).toContain('no privileged reboot request was staged');
    expect(agent).toContain('Ignoring staged elevated-job.json action');
  });
});
