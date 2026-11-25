'use strict';
// N69: executable, structural CI release gate against job dependency drift,
// unlocked dependencies, and accidentally privileged diagnostic builds.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');

function auditN69CIWorkflow(raw) {
  function fail(reason) { throw new Error('N69 CI release gate blocked: ' + reason); }
  let document;
  try {
    const parsed = YAML.parseDocument(raw, { uniqueKeys: true });
    if (parsed.errors.length) fail('invalid or duplicate YAML');
    document = parsed.toJS();
  } catch (_) {
    fail('untrusted workflow YAML');
  }
  const jobs = document && document.jobs;
  if (!jobs || typeof jobs !== 'object') fail('jobs missing');
  const win = jobs['powershell-validation'];
  const node = jobs['node-tests'];
  const api = jobs['api-tests'];
  const agent = jobs['agent-build'];
  if (!win || !node || !api || !agent) fail('required job missing');
  if (win.if !== undefined || win['runs-on'] !== 'windows-latest' ||
      !Array.isArray(win.steps) ||
      !win.steps.some(s => s.name && s.name.includes('N67 reject provisioned')) ||
      !win.steps.some(s => s.name && s.name.includes('N66 verify protected WiX'))) {
    fail('Windows signing/security validation is not unconditional and complete');
  }
  if (!Array.isArray(agent.needs) ||
      agent.needs.length !== 4 ||
      ['powershell-validation', 'node-tests', 'api-tests', 'offline-docker-load-rehearsal'].some(n => !agent.needs.includes(n))) {
    fail('signing job must depend on ALL four security/data/compatibility test jobs');
  }
  if (agent.if !== "github.event_name == 'workflow_dispatch' || github.event_name == 'push'") {
    fail('agent build event restriction changed');
  }
  if (!agent.environment ||
      !String(agent.environment.name).includes('production-installer') ||
      !String(agent.environment.name).includes('ci-diagnostic') ||
      !String(agent.environment.name).includes("github.event_name == 'workflow_dispatch'")) {
    fail('manual signing environment isolation changed');
  }
  if (!Array.isArray(agent.steps)) fail('MSI steps absent');
  const signing = agent.steps.find(s => s.name === 'Sign release EXE before WiX embeds it (or keep diagnostic only)');
  const packageStep = agent.steps.find(s => s.name === 'Build MSI');
  const finalPublication = agent.steps.find(s => s.name === 'Verify final signed artifact publication');
  const signedUpload = agent.steps.find(s => s.name === 'Upload verified signed artifacts only');
  if (!signing || !String(signing.run).includes('Release-Sign.ps1 -Stage PrePackage') ||
      !packageStep || !String(packageStep.run).includes('build-msi.ps1') ||
      !finalPublication || !String(finalPublication.if).includes("github.event_name == 'workflow_dispatch'") ||
      !String(finalPublication.if).includes("PUBLISH_SIGNED == 'true'") ||
      !signedUpload || !String(signedUpload.if).includes("PUBLICATION_VERIFIED == 'true'") ||
      !String(signedUpload.if).includes("RELEASE_APPROVAL_RECEIPT_VERIFIED == 'true'")) {
    fail('production signer, package or signed upload separation changed');
  }
  for (const [label, job] of [['node', node], ['api', api]]) {
    const steps = job.steps;
    if (!Array.isArray(steps)) fail(label + ' job has no steps');
    const installs = steps.filter(s => s.name === 'Install dependencies');
    const lint = steps.filter(s => s.name === 'Run ESLint' ||
        (String(s.run || '').trim() === 'npm run lint'));
    if (installs.length !== 1 || String(installs[0].run).trim() !== 'npm ci' ||
        lint.length < 1 ||
        steps.indexOf(lint[0]) <= steps.indexOf(installs[0])) {
      fail(label + ' may fall back to unreviewed package installation or omit lint');
    }
  }
  // Reject any bypass anywhere in the workflow, even in a newly added job.
  if (/npm\s+ci\s*\|\|\s*npm\s+install|npm\s+install\s+--force|npm\s+ci\s*--force/i.test(raw)) {
    fail('unreviewed package install fallback');
  }
  return true;
}

if (require.main === module) {
  try {
    auditN69CIWorkflow(fs.readFileSync(WORKFLOW, 'utf8'));
    console.log('N69 PASS: signing requires Windows+Node+API+offline compatibility jobs and both installs are strict npm ci.');
  } catch (_) {
    console.error('N69 CI release gate blocked.');
    process.exitCode = 1;
  }
}
module.exports = { auditN69CIWorkflow, WORKFLOW };
