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
    expect(agent).toContain('LEGACY_ELEVATED_WORKER_DISABLED');
    expect(agent.indexOf('LEGACY_ELEVATED_WORKER_DISABLED')).toBeLessThan(agent.indexOf('Import-ToolkitModules\nInitialize-Queue'));
    expect(agent).not.toContain('elevated-job.json');
    expect(agent).not.toMatch(/schtasks\.exe\s+\/run/i);
  });
});

const wix = readFileSync(new URL('../../Enterprise/agent/wix/Agent.wxs', import.meta.url), 'utf8');
const helper = readFileSync(new URL('../../Enterprise/agent/wix/Create-ElevatedTask.ps1', import.meta.url), 'utf8');
describe('legacy privileged worker retirement', () => {
  it('does not register privileged task and requires checked removal before routine task creation', () => {
    expect(wix).not.toContain('CustomAction Id="CreateElevatedTask"');
    expect(wix).toMatch(/CustomAction Id="RetireLegacyElevatedTask"[\s\S]*?Return="check"/);
    expect(wix).toContain('Action="CreateSchedTask" After="RetireLegacyElevatedTask"');
    expect(helper).toContain('Unregister-ScheduledTask');
    expect(helper).not.toMatch(/\bRegisterTask\s*\(|\bRegister-ScheduledTask\b/);
    expect(helper).toContain('LEGACY_ELEVATED_TASK_ABSENT');
  });
});
