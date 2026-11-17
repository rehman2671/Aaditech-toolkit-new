import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { normalizeAgentPosture, agentReportedCoverage } from '../../security-posture.js';
import { telemetryIngestSchema } from '../../validation.js';
import * as db from '../../db.js';

const savedEnv = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (savedEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedEnv;
});

const now = Date.parse('2026-11-17T12:00:00.000Z');
const reportedAt = new Date(now - 30000);
const legacyHealth = {
  id: 'device-old', hostname: 'CORP-01', os_version: 'Windows 11 Pro',
  bitlocker_status: 'PROTECTED', antivirus_status: 'ACTIVE',
  firewall_status: 'ENABLED', antivirus_name: 'Windows Defender',
  security_score: 95
};

describe('Stage N24 measured, fresh agent security posture', () => {
  it('does not convert legacy default health fields into measured compliance', () => {
    const row = normalizeAgentPosture(legacyHealth, now);
    expect(row.evidence_status).toBe('UNVERIFIED');
    expect(row.disk_encryption).toBeNull();
    expect(row.antivirus_status).toBeNull();
    expect(row.firewall_active).toBeNull();
    expect(row.security_score).toBeNull();
    expect(row.secure_boot).toBeNull();
    expect(row.local_admins_count).toBeNull();
    expect(row.compliance_status).toBe('Not verified');
  });

  it('reports only a fully measured recent snapshot, including actual zero scores', () => {
    const row = normalizeAgentPosture({ ...legacyHealth,
      posture_reported_at: reportedAt, security_score: 0 }, now);
    expect(row).toMatchObject({
      evidence_status: 'AGENT_REPORTED',
      evidence_source: 'ENROLLED_AGENT',
      disk_encryption: 'PROTECTED',
      firewall_active: true,
      antivirus_status: 'ACTIVE',
      bitlocker_encrypted: true,
      defender_realtime_on: true,
      security_score: 0,
      secure_boot: null,
      local_admins_count: null,
      compliance_status: 'Agent-reported compliant'
    });
  });

  it('expires evidence after 24h and refuses unsupported or future claims', () => {
    const stale = normalizeAgentPosture({ ...legacyHealth,
      posture_reported_at: new Date(now - 25 * 60 * 60 * 1000) }, now);
    expect(stale.evidence_status).toBe('STALE');
    expect(stale.bitlocker_encrypted).toBeNull();
    expect(stale.security_score).toBeNull();
    const future = normalizeAgentPosture({ ...legacyHealth,
      posture_reported_at: new Date(now + 120000) }, now);
    expect(future.evidence_status).toBe('STALE');
    expect(future.compliance_status).toBe('Not verified');
  });

  it('distinguishes unknown, partial and genuinely noncompliant observations', () => {
    const partial = normalizeAgentPosture({ ...legacyHealth,
      posture_reported_at: reportedAt, bitlocker_status: 'UNKNOWN',
      antivirus_status: 'ACTIVE', firewall_status: null }, now);
    expect(partial.compliance_status).toBe('Not verified');
    expect(partial.bitlocker_encrypted).toBeNull();
    expect(partial.firewall_active).toBeNull();
    expect(partial.security_score).toBeNull();
    const bad = normalizeAgentPosture({ ...legacyHealth,
      posture_reported_at: reportedAt, firewall_status: 'DISABLED' }, now);
    expect(bad.firewall_active).toBe(false);
    expect(bad.compliance_status).toBe('Agent-reported noncompliant');
  });

  it('percentages exclude missing/stale fields and show N/A instead of fake 0% when no evidence', () => {
    const fresh = normalizeAgentPosture({ ...legacyHealth, posture_reported_at: reportedAt }, now);
    const unknown = normalizeAgentPosture(legacyHealth, now);
    const failed = normalizeAgentPosture({ ...legacyHealth,
      posture_reported_at: reportedAt, bitlocker_status: 'UNPROTECTED' }, now);
    expect(agentReportedCoverage([unknown], 'bitlocker_encrypted')).toBe('N/A');
    expect(agentReportedCoverage([fresh, unknown, failed], 'bitlocker_encrypted')).toBe('50%');
    expect(agentReportedCoverage([fresh, unknown, failed], 'defender_realtime_on')).toBe('100%');
  });

  it('rejects invalid posture shapes and scores before server writes them', () => {
    expect(telemetryIngestSchema.safeParse({
      hostname: 'PC-1', posture: { security_score: 101 }
    }).success).toBe(false);
    expect(telemetryIngestSchema.safeParse({
      hostname: 'PC-1', posture: { security_score: -1 }
    }).success).toBe(false);
    expect(telemetryIngestSchema.safeParse({
      hostname: 'PC-1', posture: { security_score: '100' }
    }).success).toBe(false);
    expect(telemetryIngestSchema.safeParse({
      hostname: 'PC-1', posture: { suspicious_override: true }
    }).success).toBe(false);
    expect(telemetryIngestSchema.safeParse({
      hostname: 'PC-1', posture: { antivirus_status: 'UNKNOWN',
        bitlocker_status: 'UNKNOWN', firewall_status: 'UNKNOWN', security_score: null }
    }).success).toBe(true);
  });

  it('new device enrollment writes NULL health defaults, never protected/active/95', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params = []) => {
      queries.push({ sql, params });
      return [{ affectedRows: 1, insertId: 1 }, []];
    } });
    const ok = await db.syncDeviceToDb({
      id: 'device-new', tenant_id: 'tenant-A', company_id: 1,
      hostname: 'CORP-NEW', device_uid: 'uid-new', device_token_hash: 'hash'
    });
    expect(ok).toBe(true);
    const statement = queries.find(q => q.sql.includes('INSERT INTO devices'));
    expect(statement).toBeDefined();
    // The five final health status arguments precede agent_version/token hash.
    expect(statement.params.slice(17, 22)).toEqual([null, null, null, null, null]);
    expect(statement.sql).toContain('COALESCE(VALUES(bitlocker_status), bitlocker_status)');
    expect(statement.sql).toContain('COALESCE(VALUES(security_score), security_score)');
  });

  it('migration preserves historic rows but requires new server-owned evidence column', () => {
    const path = new URL('../../database/migrations/011_security_posture_provenance.sql', import.meta.url);
    const migration = fs.readFileSync(path, 'utf8');
    expect(migration).toContain('posture_reported_at DATETIME(3) NULL');
    expect(migration).toContain('MODIFY COLUMN security_score INT NULL DEFAULT NULL');
    expect(migration).not.toMatch(/UPDATE devices SET/i);
  });

  it('agent refuses to synthesize healthy posture after collector failures', () => {
    const path = new URL('../../Enterprise/agent/Aaditech-Agent.ps1', import.meta.url);
    const agent = fs.readFileSync(path, 'utf8');
    const part = agent.split('function Get-SecurityPosture {')[1]?.split('function Send-TelemetryPayload')[0];
    expect(part).toBeDefined();
    expect(part).toContain('$bitlocker = "UNKNOWN"');
    expect(part).toContain('$antivirus = "UNKNOWN"');
    expect(part).toContain('$fwStatus = "UNKNOWN"');
    expect(part).toContain('Get-MpComputerStatus -ErrorAction Stop');
    expect(part).not.toContain('$antivirus = "ACTIVE"\n    try');
  });
});
