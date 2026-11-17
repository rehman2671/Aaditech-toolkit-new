import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { extractMeasurements, evaluateMeasuredAlert } from '../../device-metrics.js';

describe('Stage N26 measured MSI worker and alert safety', () => {
  it('denies null/unknown metrics without JavaScript numeric coercion', () => {
    for (const value of [null, undefined, '', '0', -1, NaN, Infinity]) {
      expect(evaluateMeasuredAlert({metric:'disk', threshold:15}, {disk:value})).toBeNull();
      expect(evaluateMeasuredAlert({metric:'cpu', threshold:85}, {cpu:value})).toBeNull();
    }
    expect(evaluateMeasuredAlert({metric:'disk', threshold:''}, {disk:0})).toBeNull();
    expect(evaluateMeasuredAlert({metric:'disk', threshold:'invalid'}, {disk:0})).toBeNull();
    expect(evaluateMeasuredAlert({metric:'disk', threshold:15}, extractMeasurements({disk:{free_gb:null}}))).toBeNull();
  });
  it('honors genuine zero and measured threshold crossings', () => {
    const zero = extractMeasurements({cpu:{utilization_pct:0}, ram:{utilization_pct:0}, disk:{free_gb:0}});
    expect(zero).toEqual({cpu:0, ram:0, disk:0, latency:null});
    expect(evaluateMeasuredAlert({metric:'disk', threshold:'15'}, zero)).toContain('0 GB');
    expect(evaluateMeasuredAlert({metric:'cpu', threshold:85}, zero)).toBeNull();
    expect(evaluateMeasuredAlert({metric:'ram', threshold:85}, {ram:90})).toContain('90.0%');
  });
  it('canonical MSI agent probes new observations and keeps the offline event outbox distinct', () => {
    const worker = fs.readFileSync(new URL('../../Enterprise/agent/Agent-Collect.ps1', import.meta.url), 'utf8');
    const send = worker.split('function Send-AgentBatch {')[1]?.split('# ---------------------------------------------------------------- queue hygiene')[0];
    const snapshot = worker.split('function Get-FreshAgentSnapshot {')[1]?.split('function Send-AgentBatch {')[0];
    expect(snapshot).toContain('Win32_Processor -ErrorAction Stop');
    expect(snapshot).toContain('Win32_OperatingSystem -ErrorAction Stop');
    expect(snapshot).toContain("Where-Object { $_.DeviceID -eq $env:SystemDrive }");
    expect(snapshot).toContain('Get-MpComputerStatus -ErrorAction Stop');
    expect(snapshot).toContain('Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop');
    expect(snapshot).toContain('Get-NetFirewallProfile -ErrorAction Stop');
    expect(send).toContain('$snapshot = Get-FreshAgentSnapshot');
    expect(send).toContain('metrics       = $snapshot.metrics');
    expect(send).toContain('posture       = $snapshot.posture');
    expect(send).toContain('events        = @($events)');
  });
  it('server alert flow only passes finite extracted measurements', () => {
    const server = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const block = server.split('// Only fresh finite device measurements may trigger alerts')[1];
    expect(block).toContain('if (hasMeasurement)');
    expect(block).toContain('evaluateMeasuredAlert(rule, measured)');
    expect(block).not.toContain('metrics.disk.free_gb <= rule.threshold');
  });
  it('auxiliary collectors preserve unknown and actual zero', () => {
    const health = fs.readFileSync(new URL('../../Enterprise/agent/collectors/Get-SystemHealth.ps1', import.meta.url), 'utf8');
    const disk = fs.readFileSync(new URL('../../Enterprise/agent/collectors/Get-DiskHealth.ps1', import.meta.url), 'utf8');
    expect(health).toContain('} else { $null }');
    expect(disk).toContain('if ($null -ne $_.FreeSpace)');
  });
});
