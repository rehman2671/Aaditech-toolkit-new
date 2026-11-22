#!/usr/bin/env node
'use strict';

// N66: lock both security gates together before any merge of N64/N65.
// Syntax-aware YAML parsing prevents tests from silently disappearing
// during a conflict resolution in the CI workflow.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { checkWorkflows } = require('./check-github-actions-pins.cjs');
const N64_SCRIPT = './Enterprise/tests/Test-Stage64ApprovedCompilerPayload.ps1';

function inspectCombinedCI(text) {
  let data;
  try {
    const doc = YAML.parseDocument(text, { uniqueKeys: true, version: '1.2' });
    if (doc.errors.length) throw new Error('YAML errors');
    data = doc.toJS({ maxAliasCount: 0 });
  } catch {
    throw new Error('N66 CI YAML is invalid');
  }
  const jobs = data && data.jobs;
  const ps = jobs && jobs['powershell-validation'];
  if (!ps || ps['runs-on'] !== 'windows-latest' || !Array.isArray(ps.steps)) {
    throw new Error('N66 Windows PowerShell validation job missing');
  }
  const steps = ps.steps;
  const checks = [
    {
      name: 'N64 verify full SHA-approved PS2EXE payload across protected build steps (PowerShell 7)',
      run: 'pwsh -NoProfile -File ' + N64_SCRIPT
    },
    {
      name: 'N64 reject copied compiler code tampering on Windows PowerShell 5.1',
      shell: 'powershell',
      run: N64_SCRIPT
    }
  ];
  for (const expected of checks) {
    const matches = steps.filter(s => s && s.name === expected.name);
    if (matches.length !== 1 ||
        String(matches[0].run || '').trim() !== expected.run ||
        (expected.shell && matches[0].shell !== expected.shell)) {
      throw new Error('N66 N64 compiler payload test is missing or altered: ' + expected.name);
    }
  }
  const build = jobs['agent-build'];
  if (!build || build['runs-on'] !== 'windows-latest' || !Array.isArray(build.steps)) {
    throw new Error('N66 Windows MSI packaging job missing');
  }
  const protectedSteps = [
    'N63 install independently SHA-approved PS2EXE NUPKG (protected manual only)',
    'N63 install independently SHA-approved WiX NUPKG (protected manual only)',
    'Sign release EXE before WiX embeds it (or keep diagnostic only)',
    'Verify pre-signed MSI payload and sign release MSI',
    'Verify final signed artifact publication'
  ];
  for (const name of protectedSteps) {
    if (build.steps.filter(s => s && s.name === name).length !== 1) {
      throw new Error('N66 protected packaging gate missing: ' + name);
    }
  }
  if (!String(build.if || '').includes("github.event_name == 'workflow_dispatch'") ||
      !String(build.environment?.name || '').includes("'production-installer'")) {
    throw new Error('N66 protected build requires reviewed dispatch environment');
  }
  return { n64Tests: checks.length, protectedSteps: protectedSteps.length };
}
function checkCombined(repoRoot = path.resolve(__dirname, '..')) {
  const pins = checkWorkflows(repoRoot);
  const ci = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const wiring = inspectCombinedCI(ci);
  for (const file of [
    'Enterprise/agent/build/ApprovedCompilerPayload.psm1',
    'Enterprise/tests/Test-Stage64ApprovedCompilerPayload.ps1'
  ]) {
    if (!fs.statSync(path.join(repoRoot, file)).isFile()) {
      throw new Error('N66 required compiler guard is missing: ' + file);
    }
  }
  return { ...pins, ...wiring };
}
if (require.main === module) {
  const status = checkCombined();
  process.stdout.write('N66 PASS: ' + status.actionCount +
    ' immutable workflow action refs and ' + status.n64Tests +
    ' Windows N64 payload tests, protected signing gates preserved.\n');
}
module.exports = { inspectCombinedCI, checkCombined };
