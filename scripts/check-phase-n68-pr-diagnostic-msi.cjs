#!/usr/bin/env node
'use strict';
// N68: require a read-only, unsigned and nonpublishing premerge MSI rehearsal.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const CONDITION = "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.base_ref == 'main' && startsWith(github.head_ref, 'integration/')";
const CHECKOUT = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
const STEPS = Object.freeze([
  'N68 deny signing credentials and non-integration contexts',
  'Stage generic agent config (no server credentials baked into MSI)',
  'N68 install pinned diagnostic PS2EXE',
  'N68 build authentic diagnostic agent EXE',
  'N68 explicitly establish unsigned nonpublishable build',
  'N68 install pinned diagnostic WiX',
  'N68 build unsigned Windows MSI',
  'Validate MSI payload by Windows Installer administrative extraction',
  'N68 assert EXE and MSI have no publisher signature or release proof',
  'Rehearse real Windows MSI install, post-setup and clean uninstall',
  'Rehearse Windows MSI major upgrade and tenant configuration preservation'
]);
function fail(message) { throw new Error('N68 diagnostic MSI safety gate: ' + message); }
function parse(text) {
  try {
    const doc = YAML.parseDocument(text, { uniqueKeys: true, version: '1.2' });
    if (doc.errors.length) throw new Error('Invalid YAML');
    const result = doc.toJS({ maxAliasCount: 0 });
    if (!result || !result.jobs || typeof result.jobs !== 'object') fail('missing jobs');
    return result;
  } catch { fail('invalid CI workflow YAML'); }
}
function single(steps, name) {
  const matches = steps.filter(s => s && s.name === name);
  if (matches.length !== 1) fail('required unique step: ' + name);
  return matches[0];
}
function exact(step, name, content, shell) {
  if (String(step.run || '').trim() !== content || step.shell !== shell) {
    fail('execution drift: ' + name);
  }
}
function inspect(ciText) {
  const root = parse(ciText);
  const job = root.jobs['agent-diagnostic-pr'];
  if (!job || job['runs-on'] !== 'windows-latest' || job.if !== CONDITION ||
      Object.prototype.hasOwnProperty.call(job, 'environment') ||
      JSON.stringify(job.permissions) !== '{"contents":"read"}' ||
      JSON.stringify(job.needs) !== '["powershell-validation","node-tests","api-tests"]' ||
      !Array.isArray(job.steps) || job.steps.length !== STEPS.length + 1) {
    fail('PR-only same-repo integration read-only job and upstream gates');
  }
  const steps = job.steps;
  if (steps[0]?.uses !== CHECKOUT || Object.keys(steps[0]).length !== 1) {
    fail('immutable source checkout');
  }
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    if (!s || s.name !== STEPS[i - 1] || s.uses || s.if ||
        s.env || s.with || s.continue_on_error || s['continue-on-error'] ||
        typeof s.run !== 'string' || s.run.trim().length < 1) {
      fail('unexpected, bypassable or rearranged PR MSI step at position ' + i);
    }
  }
  const build = root.jobs['agent-build'];
  if (!build || !Array.isArray(build.steps)) fail('protected MSI build missing');
  const names = [
    'Stage generic agent config (no server credentials baked into MSI)',
    'Validate MSI payload by Windows Installer administrative extraction',
    'Rehearse real Windows MSI install, post-setup and clean uninstall',
    'Rehearse Windows MSI major upgrade and tenant configuration preservation'
  ];
  for (const name of names) {
    const preview = single(steps, name);
    const protectedBuild = single(build.steps, name);
    if (preview.run !== protectedBuild.run || preview.shell !== protectedBuild.shell) {
      fail('preview and main MSI validation diverged: ' + name);
    }
  }
  const guard = single(steps, STEPS[0]).run;
  for (const token of ['GITHUB_EVENT_NAME', 'GITHUB_BASE_REF', 'GITHUB_HEAD_REF',
    'CODESIGN_PFX_B64', 'CODESIGN_PFX_PASSWORD', 'RELEASE_APPROVAL_SIGNATURE_B64',
    'RELEASE_APPROVAL_MANIFEST_B64', 'GH_TOKEN']) {
    if (!guard.includes(token)) fail('credential/context guard missing: ' + token);
  }
  exact(single(steps, STEPS[2]), STEPS[2],
    'Install-Module -Name ps2exe -RequiredVersion 1.0.18 -Repository PSGallery -Force -Scope CurrentUser',
    'powershell');
  exact(single(steps, STEPS[3]), STEPS[3],
    './Enterprise/agent/build/build-agent.ps1', 'powershell');
  exact(single(steps, STEPS[4]), STEPS[4],
    './Enterprise/agent/build/Release-Sign.ps1 -Stage PrePackage', 'pwsh');
  exact(single(steps, STEPS[5]), STEPS[5],
    'dotnet tool install --global wix --version 5.0.2', 'pwsh');
  const packageStep = single(steps, STEPS[6]).run;
  for (const token of ["RELEASE_SIGNING_ENABLED -cne 'false'",
    "PUBLISH_SIGNED -cne 'false'", './Enterprise/agent/wix/build-msi.ps1']) {
    if (!packageStep.includes(token)) fail('diagnostic MSI packaging gate missing: ' + token);
  }
  const unsigned = single(steps, STEPS[8]).run;
  for (const token of ["RELEASE_SIGNING_ENABLED -cne 'false'",
    "PUBLISH_SIGNED -cne 'false'", 'Get-AuthenticodeSignature',
    "'NotSigned'", '$items.Count -ne 2']) {
    if (!unsigned.includes(token)) fail('unsigned artifact assertion missing: ' + token);
  }
  const raw = JSON.stringify(job);
  if (/secrets\s*\.|gh\s+release|actions\/upload-artifact|PUBLISH_SIGNED\s*==\s*'true'/i.test(raw)) {
    fail('forbidden signing secrets or publication command in PR job');
  }
  return { checkedSteps: steps.length, comparedWindowsSteps: names.length };
}
function check(root = path.resolve(__dirname, '..')) {
  return inspect(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
}
if (require.main === module) {
  const checked = check();
  process.stdout.write('N68 PASS: ' + checked.checkedSteps +
    ' read-only unsigned Windows PR MSI steps, main install and upgrade checks mirrored.\n');
}
module.exports = { CONDITION, STEPS, inspect, check };
