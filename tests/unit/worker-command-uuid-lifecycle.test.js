import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { commandResultSchema } from '../../validation.js';
const s=readFileSync(new URL('../../Enterprise/agent/Agent-Collect.ps1',import.meta.url),'utf8');
describe('installed worker UUID command lifecycle',()=>{
  it('uses a separate UUID ledger, retaining the old integer table',()=>{
    expect(s).toContain('CREATE TABLE IF NOT EXISTS executed_commands_v2');
    expect(s).toContain('command_id TEXT PRIMARY KEY NOT NULL');
    expect(s).toContain('INSERT OR IGNORE INTO executed_commands_v2');
    expect(s).toContain('SELECT changes();');
    expect(s).not.toContain('param([int]$CommandId');
  });
  it('verifies before claim, executes then records before reporting',()=>{
    const section=s.slice(s.indexOf('function Invoke-VerifiedCommandOnce {'),s.indexOf('# ------------------------------------------------------------------ main'));
    const order=['Resolve-VerifiedAgentCommand','Try-ClaimVerifiedCommand','Invoke-RemoteCommand','Record-ExecutedCommand','Send-CommandResult -Config $Config -CmdId $id -Result $normalized'].map(x=>section.indexOf(x));
    expect(order.every(x=>x>=0)).toBe(true);
    expect(order).toEqual([...order].sort((a,b)=>a-b));
    expect(s.match(/Invoke-VerifiedCommandOnce -Config \$Config -Cmd \$cmd/g)).toHaveLength(2);
  });
  it('does not send hostname in a strict result body',()=>{
    expect(commandResultSchema.safeParse({status:'completed',output:'ok',exit_code:0}).success).toBe(true);
    expect(commandResultSchema.safeParse({hostname:'PC',status:'completed',output:'ok',exit_code:0}).success).toBe(false);
    const block=s.slice(s.indexOf('function Send-CommandResult {'),s.indexOf('function Invoke-VerifiedCommandOnce {'));
    expect(block).not.toContain('hostname  =');
    expect(block).toContain('ConvertTo-CommandResult $Result');
  });
});
