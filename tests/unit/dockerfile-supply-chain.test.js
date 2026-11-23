import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

describe('production Docker supply-chain fail-closed install', () => {
  it('requires an explicit package-lock.json rather than a permissive glob', () => {
    expect(dockerfile).toMatch(/^COPY package\.json package-lock\.json \.\/$/m);
    expect(dockerfile).not.toContain('COPY package*.json');
  });

  it('uses npm ci for the production dependency graph, never fallback npm install', () => {
    const runCommands = dockerfile.split('\n').filter(line => /^RUN npm\b/.test(line));
    expect(runCommands).toEqual(['RUN npm ci --omit=dev --no-audit --no-fund']);
    expect(dockerfile).not.toMatch(/\bnpm install\b|\bnpm update\b|\bnpm audit\b/);
  });

  it('does not misrepresent this change as pinned-image or offline acceptance', () => {
    expect(dockerfile).toContain('offline LAN');
    expect(dockerfile).toContain('still needs pinned image digests');
  });
});
