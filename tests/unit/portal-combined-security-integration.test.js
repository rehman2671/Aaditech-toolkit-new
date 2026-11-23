import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The two separately reviewed portal security fixes share a single static
// document and must remain integrated in the same executable script.
const html = readFileSync(new URL('../../Enterprise/portal/index.html', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

describe('FE-38 + FE-39 + offline build integration gate', () => {
  it('retains exactly one runtime function for each security view', () => {
    expect(html.match(/async function renderIntegrations\(\)/g)).toHaveLength(1);
    expect(html.match(/async function renderPatches\(\)/g)).toHaveLength(1);
    expect(html.match(/function cloudAuditBadge\(/g)).toHaveLength(1);
    expect(html.match(/function patchAgentFresh\(/g)).toHaveLength(1);
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it('leaves no invented hardcoded compliance or deployment claims in either view', () => {
    expect(html).not.toContain("value: '94 / 100'");
    expect(html).not.toContain("value: '100% Active'");
    expect(html).not.toContain('Approve & Deploy');
    expect(html).not.toContain('Continuous\'}');
    expect(html).toContain('Not connected');
    expect(html).toContain('Not measured');
    expect(html).toContain('Approve for rollout');
    expect(html).toContain('No patch installation was triggered or verified');
  });

  it('keeps the generic AV evidence and production lockfile contract', () => {
    expect(html).toContain("localSecurityStatus(ac, 'antivirus_active'");
    expect(html).toContain("agent.antivirus_active === true");
    expect(dockerfile).toContain('RUN npm ci --omit=dev --no-audit --no-fund');
    expect(dockerfile).not.toContain('RUN npm ci --omit=dev ||');
  });
});
