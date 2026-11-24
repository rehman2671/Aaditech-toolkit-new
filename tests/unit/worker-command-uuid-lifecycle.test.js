import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { commandResultSchema } from '../../validation.js';
const s=readFileSync(new URL('../../Enterprise/agent/Agent-Collect.ps1',import.meta.url),'utf8');
describe('installed worker durable UUID result lifecycle',()=>{
  it('retains old ledgers, uses unique bound UUID claims and no int conversion',()=>{
    expect(s).toContain('CREATE TABLE IF NOT EXISTS command_results_v3');
    expect(s).toContain('command_id TEXT PRIMARY KEY NOT NULL');
    expect(s).toContain('INSERT OR IGNORE INTO command_results_v3');
    expect(s).toContain('WHERE NOT EXISTS (SELECT 1 FROM executed_commands_v2');
    expect(s).not.toContain('param([int]$CommandId');
  });
  it('verifies before claim, executes then records before delivery',()=>{
    const section=s.slice(s.indexOf('function Invoke-VerifiedCommandOnce {'),s.indexOf('# ------------------------------------------------------------------ main'));
    const order=['Resolve-VerifiedAgentCommand','Try-ClaimVerifiedCommand','Invoke-RemoteCommand','Record-ExecutedCommand'].map(x=>section.indexOf(x));
    expect(order.every(x=>x>=0)).toBe(true);
    expect(order).toEqual([...order].sort((a,b)=>a-b));
    // The legacy privileged cycle was retired in O1. Exactly one normal
    // command execution and outbox delivery path must remain.
    expect(s.match(/Invoke-VerifiedCommandOnce -Config \$Config -Cmd \$cmd/g)).toHaveLength(1);
    expect(s.match(/Send-PendingCommandResults -Config \$Config/g)).toHaveLength(1);
    const guard = /if \(\$ElevatedOnce\)\s*\{\s*Write-Output 'LEGACY_ELEVATED_WORKER_DISABLED'\s*exit 3\s*\}/g;
    const matches = [...s.matchAll(guard)];
    expect(matches).toHaveLength(1);
    const main = s.indexOf('# ------------------------------------------------------------------ main');
    expect(main).toBeGreaterThan(matches[0].index);
    expect(s.slice(main)).not.toMatch(/\$ElevatedOnce|Request-ElevatedJob/);
    expect(s.indexOf('Invoke-VerifiedCommandOnce -Config $Config -Cmd $cmd', main))
      .toBeLessThan(s.indexOf('Send-PendingCommandResults -Config $Config', main));
  });
  it('persists strict normalized body and requires a matching authoritative receipt',()=>{
    expect(commandResultSchema.safeParse({status:'completed',output:'ok',exit_code:0}).success).toBe(true);
    expect(commandResultSchema.safeParse({hostname:'PC',status:'completed',output:'ok',exit_code:0}).success).toBe(false);
    expect(s).toContain("body=CAST(X'$bodyHex' AS TEXT),delivery='pending'");
    expect(s).toContain("MaximumRedirection=0");
    expect(s).toContain("delivery='acknowledged'");
    expect(s).toContain("aaditech:command-result-binding:v1");
  });
});
