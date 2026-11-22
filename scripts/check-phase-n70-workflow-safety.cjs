'use strict';
// N70: fail closed before protected packaging if any critical GitHub Action is
// changed to a floating reference or main safety checks are path filtered.
// Exact SHA values are pinned from official actions/* v4 Git refs at review
// time; only an independent reviewer can approve their source/provenance.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const root = path.join(__dirname, '..');
const WORKFLOWS = [
  '.github/workflows/ci.yml',
  '.github/workflows/deployment-safety.yml',
  '.github/workflows/project-index-maintenance.yml',
  '.github/workflows/publish-signed-installer.yml',
];
const PINNED = Object.freeze({
  'actions/checkout': '11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node': '49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/download-artifact': 'd3f86a106a0bac45b974a628896c90dbdf5c8093',
});
const JOB_NAMES = Object.freeze({
  'mysql-backup-restore': 'Bash syntax and offline database recovery tests',
  'mysql-live-rehearsal': 'Isolated MySQL 8 backup and restore data integrity',
});
function fail() { throw new Error('N70 GitHub security workflow governance blocked.'); }

function yamlObject(raw) {
  try {
    const doc = YAML.parseDocument(raw, { uniqueKeys: true });
    if (doc.errors.length) fail();
    const parsed = doc.toJS();
    if (!parsed || typeof parsed !== 'object') fail();
    return parsed;
  } catch (_) { fail(); }
}

function auditN70WorkflowBundle(files) {
  if (!files || typeof files !== 'object') fail();
  let actionCount=0;
  for (const filename of WORKFLOWS) {
    const raw = files[filename];
    if (typeof raw !== 'string' || !raw.trim()) fail();
    const wf = yamlObject(raw);
    if (!wf.jobs || typeof wf.jobs !== 'object') fail();
    for (const [jobName, job] of Object.entries(wf.jobs)) {
      if (!job || !Array.isArray(job.steps)) fail();
      for (const step of job.steps) {
        if (step.uses !== undefined) {
          if (typeof step.uses !== 'string') fail();
          const match = /^(actions\/[a-z][a-z0-9-]*)@([0-9a-f]{40})$/.exec(step.uses);
          if (!match || PINNED[match[1]] !== match[2]) fail();
          actionCount++;
        }
      }
      if (!jobName || !job['runs-on'] && !job.uses) fail();
    }
    if (filename.endsWith('deployment-safety.yml')) {
      const events=wf.on;
      if (!events || typeof events !== 'object' || Array.isArray(events)) fail();
      const keys=Object.keys(events).sort();
      if (JSON.stringify(keys) !== JSON.stringify(['pull_request','push','workflow_dispatch'])) fail();
      const push=events.push, pull=events.pull_request;
      if (!push || !pull || typeof push !== 'object' || typeof pull !== 'object') fail();
      if (JSON.stringify(push) !== JSON.stringify({branches:['main']}) ||
          JSON.stringify(pull) !== JSON.stringify({branches:['main']})) fail();
      if (events.workflow_dispatch !== null && typeof events.workflow_dispatch !== 'object') fail();
      const safetyKeys=Object.keys(wf.jobs);
      if (safetyKeys.length !== 2 || Object.keys(JOB_NAMES).some(k => !safetyKeys.includes(k))) fail();
      for (const [k, name] of Object.entries(JOB_NAMES)) {
        const job=wf.jobs[k];
        if (job.name !== name || job.if !== undefined ||
            job.permissions?.contents !== 'read' || job['runs-on'] !== 'ubuntu-latest') fail();
      }
      const bash=wf.jobs['mysql-backup-restore'].steps.map(s=>String(s.run||'')).join('\n');
      const mysql=wf.jobs['mysql-live-rehearsal'].steps.map(s=>String(s.run||'')).join('\n');
      for (const script of ['Test-MySQL-Backup-Restore.sh','Test-DeployMySQL.sh',
                            'Test-Stage68StrictVpsAcceptance.sh','Test-Stage31Preflight.sh']) {
        if (!bash.includes(script)) fail();
      }
      // A syntax-only `bash -n` mention must never count as actually
      // executing recovery or live-VPS denial tests.
      if (!bash.includes('bash Enterprise/tests/Test-Stage68StrictVpsAcceptance.sh') ||
          !bash.includes('bash Enterprise/tests/Test-DeployMySQL.sh') ||
          !mysql.includes('AADITECH_REHEARSAL=isolated-ci bash Enterprise/tests/Test-MySQL-Live-Rehearsal.sh') ||
          !mysql.includes('Test-LegacyMsiMigration-Live.sh') ||
          !mysql.includes('docker compose') || !mysql.includes('down -v')) fail();
      if (!raw.includes('branches: [main]')) fail();
    }
  }
  if (actionCount !== 13) fail();
  return true;
}

function readBundle() {
  return Object.fromEntries(WORKFLOWS.map(filename=>[
    filename, fs.readFileSync(path.join(root, filename), 'utf8')
  ]));
}

if (require.main === module) {
  try {
    auditN70WorkflowBundle(readBundle());
    console.log('N70 PASS: universal main safety checks and 13 immutable official action refs verified.');
  } catch (_) {
    console.error('N70 GitHub security workflow governance blocked.');
    process.exitCode=1;
  }
}
module.exports={auditN70WorkflowBundle,readBundle,WORKFLOWS,PINNED};
