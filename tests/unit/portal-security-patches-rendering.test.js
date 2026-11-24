import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const portal = readFileSync(new URL('../../Enterprise/portal/index.html', import.meta.url), 'utf8');
const section = portal.split('// ---------------------------------------------------------------- Patch & Security Compliance')[1]
  ?.split('// ---------------------------------------------------------------- Device Groups & Policies')[0];
const statCards = 'function statCardsEl(cards) {' +
  portal.split('function statCardsEl(cards) {')[1]?.split('const VIEW_META')[0];
const escapeDeclaration = portal.match(/^const esc = .*;$/m)?.[0];
const iconDeclaration = portal.match(/^const ic = .*;$/m)?.[0];

const freshDate = () => new Date(Date.now() - 30_000).toISOString();
const healthy = (extra = {}) => ({
  hostname: 'LAPTOP-01', os: 'Windows 11', evidence_status: 'AGENT_REPORTED',
  posture_reported_at: freshDate(), firewall_active: true, antivirus_status: 'ACTIVE',
  disk_encryption: 'PROTECTED', bitlocker_encrypted: true,
  secure_boot: null, security_score: 95, ...extra
});

async function renderView(rawPosture = [], rawPatches = []) {
  expect(section).toBeDefined();
  const app = { innerHTML: '' };
  const stats = { innerHTML: '' };
  const alerts = [];
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/api/v1/security/posture') return rawPosture;
    if (path === '/api/v1/patches/summary') return rawPatches;
    if (path.startsWith('/api/v1/patches/') && path.endsWith('/approve'))
      return { id: 'patch-id', status: 'APPROVED' };
    throw new Error('Unknown API call ' + path);
  };
  const context = vm.createContext({
    app, api, alert: msg => alerts.push(msg), encodeURIComponent, Date, Math,
    document: { getElementById: id => id === 'statcards' ? stats : null }
  });
  vm.runInContext([escapeDeclaration, iconDeclaration, statCards, section].join('\n'),
    context, { timeout: 1000 });
  await vm.runInContext('renderPatches()', context, { timeout: 1000 });
  return { app, stats, context, alerts, calls };
}

describe('FE-39 truthful security/patch dashboard', () => {
  it('renders no fabricated score/encryption/antivirus on empty data', async () => {
    const { app, stats } = await renderView();
    expect(stats.innerHTML).toContain('N/A');
    expect(stats.innerHTML).not.toContain('94 / 100');
    expect(stats.innerHTML).not.toContain('100% Active');
    expect(stats.innerHTML).not.toContain('Protected');
    expect(stats.innerHTML).not.toContain('data-tone="good"');
    expect(app.innerHTML).toContain('No enrolled-agent security observations');
    expect(app.innerHTML).toContain('this is not a claim that all endpoints are patched');
    expect(app.innerHTML).not.toContain('class="badge on"');
  });

  it('never calls unreported/stale/expired snapshots protected', async () => {
    const { app, stats } = await renderView([
      healthy({ evidence_status: 'UNVERIFIED', security_score: null }),
      healthy({ evidence_status: 'STALE' }),
      healthy({ posture_reported_at: new Date(Date.now()-26*60*60*1000).toISOString() })
    ]);
    expect(app.innerHTML).not.toContain('class="badge on"');
    expect(app.innerHTML).toContain('Not verified');
    expect(app.innerHTML).toContain('Stale — not verified');
    expect(app.innerHTML).toContain('Not measured');
    expect(stats.innerHTML).toContain('N/A');
  });

  it('correctly aggregates measured healthy endpoints without claiming Secure Boot', async () => {
    const { app, stats } = await renderView([healthy()]);
    expect(stats.innerHTML).toContain('95 / 100');
    expect(stats.innerHTML).toContain('100%');
    expect(stats.innerHTML).toContain('data-tone="info"');
    expect(app.innerHTML).toContain('Enabled (agent-reported)');
    expect(app.innerHTML).toContain('ACTIVE'.toLowerCase().replace('active', 'Active (agent-reported)'));
    expect(app.innerHTML).toContain('PROTECTED (agent-reported)');
    expect(app.innerHTML).toContain('Not measured');
  });

  it('keeps genuine score zero and negative observations noncompliant', async () => {
    const { app, stats } = await renderView([healthy({
      firewall_active: false, antivirus_status: 'DISABLED',
      disk_encryption: 'UNPROTECTED', bitlocker_encrypted: false,
      security_score: 0, secure_boot: false
    })]);
    expect(stats.innerHTML).toContain('0 / 100');
    expect(stats.innerHTML).toContain('0%');
    expect(app.innerHTML).toContain('Disabled (agent-reported)');
    expect(app.innerHTML).toContain('UNPROTECTED (agent-reported)');
    expect(app.innerHTML).toContain('class="badge off"');
    expect(app.innerHTML).not.toContain('class="badge on"');
  });

  it('treats partial and invalid numeric scores as unverified', async () => {
    const { app, stats } = await renderView([
      healthy({ disk_encryption: null, antivirus_status: null, security_score: 101 }),
      healthy({ hostname: 'B', disk_encryption: 'UNKNOWN', security_score: '95' })
    ]);
    expect(stats.innerHTML).toContain('N/A');
    expect(app.innerHTML).toContain('Not verified');
    expect(app.innerHTML).not.toContain('101 / 100');
    expect(app.innerHTML).not.toContain('95 / 100');
  });

  it('never interprets zero pending approvals as zero missing OS patches', async () => {
    const { app, stats } = await renderView([], []);
    expect(stats.innerHTML).toContain('Approval is not installation');
    expect(stats.innerHTML).not.toContain('data-tone="good"');
    expect(app.innerHTML).toContain('No OS patch approval records');
  });

  it('calls approval only and never claims patch installation', async () => {
    const { app, stats, context, alerts, calls } = await renderView([], [{
      id: 'KB/42', title: 'Update', severity: 'Critical',
      release_date: '2026-11-20', affected_devices: 2, status: 'PENDING_APPROVAL'
    }]);
    expect(stats.innerHTML).toContain('Patches pending approval');
    expect(app.innerHTML).toContain('Approve for rollout');
    expect(app.innerHTML).not.toContain('Approve & Deploy');
    await vm.runInContext("approvePatch('KB/42')", context);
    expect(calls.some(c => c.path === '/api/v1/patches/KB%2F42/approve' && c.options.method === 'POST')).toBe(true);
    expect(alerts.some(x => x.includes('No patch installation was triggered or verified'))).toBe(true);
  });

  it('preserves successful approval as not installed', async () => {
    const { app } = await renderView([], [{
      id: '123', title: 'Patch', severity: 'High', release_date: '2026-11-20',
      affected_devices: 4, status: 'APPROVED'
    }]);
    expect(app.innerHTML).toContain('Approved for rollout (not installed)');
    expect(app.innerHTML).toContain('No installation confirmed');
    expect(app.innerHTML).not.toContain('Approve & Deploy');
  });

  it('escapes hostile IDs, titles, hostnames and untrusted affected-device counts', async () => {
    const bad = '\" onclick=\"throw new Error(1)\" <script>pwn</script>';
    const { app } = await renderView([healthy({ hostname: bad, os: bad })], [{
      id: bad, title: bad, severity: bad, release_date: bad,
      affected_devices: bad, status: 'PENDING_APPROVAL'
    }]);
    expect(app.innerHTML).toContain('&lt;script&gt;');
    expect(app.innerHTML).not.toContain('<script>');
    expect(app.innerHTML).toContain('data-patch-id=');
    expect(app.innerHTML).toContain('onclick="approvePatch(this.dataset.patchId)"');
    expect(app.innerHTML).toContain('N/A Devices');
  });

  it('handles malformed array and null error responses without crashing or fabricating data', async () => {
    const bad = await renderView({ not: 'array' }, { not: 'array' });
    expect(bad.app.innerHTML).toContain('No enrolled-agent security observations');
    const error = await renderView(null, null);
    expect(error.app.innerHTML).toBe('');
  });
});
