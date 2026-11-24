import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const standalone = readFileSync(new URL('../../Enterprise/agent/Aaditech-Agent.ps1', import.meta.url), 'utf8');
const installed = readFileSync(new URL('../../Enterprise/agent/Agent-Collect.ps1', import.meta.url), 'utf8');

describe('P0 standalone agent remote execution retirement', () => {
  it('never polls signed commands or executes uncontrolled remote actions', () => {
    for (const forbidden of [
      'function Poll-And-Execute-Commands', 'function Verify-CommandSignature',
      'switch -Regex ($cmd.kind)', 'Remove-Item "$env:TEMP',
      'Restart-Service -Name "Spooler"', '/api/commands/poll',
      'Reboot scheduled in 60 seconds'
    ]) expect(standalone).not.toContain(forbidden);
    expect(standalone).toContain('TELEMETRY-ONLY');
    expect(standalone).toContain('Send-TelemetryPayload');
    expect(standalone).toContain('Remote commands disabled');
  });
  it('keeps device-bound domain-separated signature validation in installed worker', () => {
    expect(installed).toContain('function Resolve-VerifiedAgentCommand');
    expect(installed).toContain('aaditech:agent-command:v1');
    expect(installed).toContain('agent.identity.json');
    expect(installed).toContain('function Invoke-RemoteCommand');
  });
});
