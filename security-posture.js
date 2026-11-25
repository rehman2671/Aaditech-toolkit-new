// Stage N24: a device enrollment is not security telemetry. Report unknown
// unless an enrolled agent has submitted explicit, recent posture observations.
// These observations are device-reported, never MDM/cloud attestation.
const FRESHNESS_MS = 24 * 60 * 60 * 1000;

// Generic enrolled-agent antivirus evidence must not be misreported as
// Microsoft Defender telemetry. Names are agent assertions, not MDM proof.
function observedMicrosoftDefenderName(name) {
  return typeof name === 'string' &&
    ['windows defender', 'windows defender antivirus', 'microsoft defender antivirus']
      .includes(name.trim().toLowerCase());
}

function status(raw, allowed) {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return allowed.includes(value) ? value : null;
}

function reportedAt(value) {
  if (!value) return null;
  // mysql2 returns Date for DATETIME; JSON fixtures may use ISO strings.
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeAgentPosture(row, now = Date.now()) {
  const at = reportedAt(row?.posture_reported_at);
  const fresh = at !== null && at <= now && (now - at) <= FRESHNESS_MS;
  const sourceStatus = at === null ? 'UNVERIFIED' : fresh ? 'AGENT_REPORTED' : 'STALE';
  const encrypted = fresh ? status(row?.bitlocker_status,
    ['PROTECTED', 'ENCRYPTED', 'UNPROTECTED', 'SUSPENDED']) : null;
  const antivirus = fresh ? status(row?.antivirus_status,
    ['ACTIVE', 'INACTIVE', 'DISABLED']) : null;
  const firewall = fresh ? status(row?.firewall_status,
    ['ENABLED', 'DISABLED']) : null;
  const antivirusName = fresh && typeof row?.antivirus_name === 'string' &&
    row.antivirus_name.trim() ? row.antivirus_name.trim().slice(0, 128) : null;
  const allMeasured = Boolean(encrypted && antivirus && firewall);
  const reportedScore = row?.security_score;
  const score = fresh && allMeasured && typeof reportedScore === 'number' &&
    Number.isInteger(reportedScore) && reportedScore >= 0 && reportedScore <= 100
    ? reportedScore : null;
  const healthy = allMeasured && ['PROTECTED', 'ENCRYPTED'].includes(encrypted) &&
    antivirus === 'ACTIVE' && firewall === 'ENABLED';
  return {
    evidence_status: sourceStatus,
    evidence_source: fresh ? 'ENROLLED_AGENT' : null,
    posture_reported_at: at === null ? null : new Date(at).toISOString(),
    firewall_active: firewall === null ? null : firewall === 'ENABLED',
    firewall_status: firewall,
    antivirus_name: antivirusName,
    antivirus_status: antivirus,
    disk_encryption: encrypted,
    secure_boot: null, // No measured Secure Boot collector / attestation.
    local_admins_count: null, // No measured privileged local user inventory.
    security_score: score,
    bitlocker_encrypted: encrypted === null ? null : ['PROTECTED', 'ENCRYPTED'].includes(encrypted),
    antivirus_active: antivirus === null ? null : antivirus === 'ACTIVE',
    // Only label agent antivirus status "Defender" when the reported product
    // explicitly names Microsoft Defender; other AVs are unknown, not false.
    defender_realtime_on: antivirus === null || !observedMicrosoftDefenderName(antivirusName)
      ? null : antivirus === 'ACTIVE',
    compliance_status: !fresh || !allMeasured ? 'Not verified' :
      healthy ? 'Agent-reported compliant' : 'Agent-reported noncompliant'
  };
}

export function agentReportedCoverage(postures, field) {
  const known = postures.filter(p => typeof p[field] === 'boolean');
  if (!known.length) return 'N/A';
  return Math.round(known.filter(p => p[field]).length / known.length * 100) + '%';
}
