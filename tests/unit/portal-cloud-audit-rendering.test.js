import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const portal = readFileSync(new URL('../../Enterprise/portal/index.html', import.meta.url), 'utf8');
const definition = portal.split('// ---------------- GAP FULFILLMENT: TICKETS & CLOUD AUDIT VIEW ----------------')[1]
  ?.split('async function saveTicketConfig()')[0];
const statCards = 'function statCardsEl(cards) {' +
  portal.split('function statCardsEl(cards) {')[1]?.split('const VIEW_META')[0];
const escapeDeclaration = portal.match(/^const esc = .*;$/m)?.[0];
const iconDeclaration = portal.match(/^const ic = .*;$/m)?.[0];

async function renderAudit(cloud, tickets = []) {
  expect(definition).toBeDefined();
  const app = { innerHTML: '' };
  const stats = { innerHTML: '' };
  const api = async (url) => {
    if (url === '/api/tickets/config') return { system: 'none', url: '', project: '' };
    if (url === '/api/tickets/list') return tickets;
    if (url === '/api/compliance/cloud-audit') return cloud;
    throw new Error('Unexpected API route: ' + url);
  };
  const context = vm.createContext({
    app, api, document: { getElementById: id => id === 'statcards' ? stats : null },
    Date, Math
  });
  vm.runInContext([escapeDeclaration, iconDeclaration, statCards, definition].join('\n'), context,
    { timeout: 1000 });
  await vm.runInContext('renderIntegrations()', context, { timeout: 1000 });
  return { html: app.innerHTML, stats: stats.innerHTML };
}

const now = () => new Date(Date.now() - 30_000).toISOString();
const current = (extra = {}) => ({
  hostname: 'OFFICE-01', azure_ad_joined: null, intune_managed: null,
  bitlocker_encrypted: true, antivirus_active: true, firewall_active: true,
  posture_reported_at: now(), evidence_status: 'AGENT_REPORTED',
  compliance_status: 'Agent-reported compliant', ...extra
});
const response = (agent_compliance = [], extras = {}) => ({
  configured: false, status: 'NOT_CONNECTED',
  summary: { azure_ad_sync: 'Not connected', intune_enrolled_pct: 'N/A',
    bitlocker_compliant_pct: 'N/A' },
  cloud_services: [], agent_compliance, ...extras
});

describe('FE-38 portal hybrid/cloud audit status truthfulness', () => {
  it('never paints disconnected Azure/Intune or unknown local security as success', async () => {
    const { html, stats } = await renderAudit(response([{
      hostname: 'OFFICE-01', azure_ad_joined: null, intune_managed: null,
      bitlocker_encrypted: null, antivirus_active: null,
      evidence_status: 'UNVERIFIED', posture_reported_at: null,
      compliance_status: 'Not verified'
    }]));
    expect(html).toContain('No cloud service connected');
    expect(html).toContain('Not connected');
    expect(html).toContain('Not verified');
    expect(html).not.toContain('class="badge ok"');
    expect(stats).toContain('Not connected');
    expect(stats).toContain('N/A');
    expect(stats).not.toContain('data-tone="ok"');
  });

  it('fails closed on stale, future, missing-date and inconsistent agent evidence', async () => {
    const stale = current({ evidence_status: 'STALE' });
    const expired = current({ posture_reported_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() });
    const future = current({ posture_reported_at: new Date(Date.now() + 60_000).toISOString() });
    const missing = current({ posture_reported_at: null });
    const { html, stats } = await renderAudit(response([stale, expired, future, missing]));
    expect(html).not.toContain('class="badge ok"');
    expect(html).toContain('Stale — not verified');
    expect(stats).toContain('N/A');
  });

  it('qualifies positive observations as fresh AGENT-reported, not cloud attestation', async () => {
    const { html, stats } = await renderAudit(response([current()]));
    expect(html).toContain('Encrypted (agent-reported)');
    expect(html).toContain('Active (agent-reported)');
    expect(html).toContain('Agent-reported compliant');
    expect(html).toContain('class="badge ok"');
    expect(html).toContain('Not connected');
    expect(html).not.toContain('cloud-reported');
    expect(stats).toContain('100%');
    expect(stats).not.toContain('data-tone="ok"');
  });

  it('does not turn negative evidence or overall noncompliance green', async () => {
    const { html, stats } = await renderAudit(response([
      current({ bitlocker_encrypted: false, antivirus_active: false,
        compliance_status: 'Agent-reported noncompliant' })
    ]));
    expect(html).toContain('Not encrypted (agent-reported)');
    expect(html).toContain('Inactive (agent-reported)');
    expect(html).toContain('Agent-reported noncompliant');
    expect(html).not.toContain('class="badge ok"');
    expect(html).toContain('class="badge off"');
    expect(stats).toContain('0%');
  });

  it('does not promote incomplete or contradictory compliance data', async () => {
    const { html, stats } = await renderAudit(response([
      current({ bitlocker_encrypted: null }),
      current({ hostname: 'OFFICE-02', firewall_active: false })
    ]));
    expect(html).toContain('Not verified');
    expect(html).not.toContain('Agent-reported compliant</span>');
    expect(stats).toContain('100%');
    expect(stats).toContain('1 of 2 devices measured');
    expect(html).toContain('Agent-reported noncompliant');
  });

  it('has an explicit empty state for missing cloud service and agent arrays', async () => {
    const { html, stats } = await renderAudit(response(undefined, {
      cloud_services: null, agent_compliance: null, summary: null
    }));
    expect(html).toContain('No cloud service connected');
    expect(html).toContain('No enrolled-agent security evidence');
    expect(stats).toContain('N/A');
  });

  it('shows actual missing connector sync and latency as N/A, no fake Continuous', async () => {
    const { html } = await renderAudit(response([], {
      configured: true, status: 'CONNECTED',
      cloud_services: [{ name: 'Graph', status: 'UNKNOWN', last_sync: null, latency_ms: null },
        { name: 'Intune', status: 'FAILED', last_sync: 'not-a-date', latency_ms: -1 }]
    }));
    expect(html).toContain('N/A');
    expect(html).not.toContain('Continuous');
    expect(html).not.toContain('null ms');
    expect(html).not.toContain('undefined ms');
    expect(html).toContain('class="badge off"');
    expect(html).not.toContain('class="badge ok"');
  });

  it('never infers Azure/Intune cloud enrollment from local agent status', async () => {
    const { html } = await renderAudit(response([current({ azure_ad_joined: true,
      intune_managed: true })]));
    expect(html).toContain('Not connected');
    expect(html).not.toContain('cloud-reported');
  });

  it('escapes agent and connector strings before appending HTML', async () => {
    const malicious = '</td><script>throw new Error("injection")</script>';
    const { html } = await renderAudit(response([current({ hostname: malicious })], {
      configured: true, status: 'CONNECTED',
      cloud_services: [{ name: malicious, status: malicious }]
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('throw new Error("injection")</script>');
  });

  it('only promotes independently connected cloud bools, not false/null states', async () => {
    const { html } = await renderAudit(response([current({
      azure_ad_joined: true, intune_managed: false
    })], { configured: true, status: 'CONNECTED' }));
    expect(html).toContain('Joined (cloud-reported)');
    expect(html).toContain('Not enrolled (cloud-reported)');
    expect(html).toContain('class="badge off"');
  });
});
