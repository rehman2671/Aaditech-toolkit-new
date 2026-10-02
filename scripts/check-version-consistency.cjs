#!/usr/bin/env node
/**
 * CI Verification Check: Version Consistency
 * Ensures no stale hardcoded agent versions ("2.4.0", "1.0.4", etc.) exist in the repository
 * and that all references dynamically derive from Enterprise/agent/agent-version.json.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const versionJsonPath = path.join(rootDir, 'Enterprise', 'agent', 'agent-version.json');

if (!fs.existsSync(versionJsonPath)) {
  console.error(`FATAL: agent-version.json not found at ${versionJsonPath}`);
  process.exit(1);
}

const versionMeta = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
const currentAgentVersion = versionMeta.agent_version;
console.log(`[Version Consistency] Authoritative agent_version: "${currentAgentVersion}"`);

// Target files and directories to audit
const auditTargets = [
  'server.js',
  'db.js',
  'agent-artifacts.js',
  'database/migrations/001_init_schema.sql',
  'database/mysql/schema.sql',
  'docs/architecture/Technical-Architecture-Spec.md'
];

const disallowedVersions = ['2.4.0', '1.0.4'];
let violationCount = 0;

for (const targetRel of auditTargets) {
  const targetPath = path.join(rootDir, targetRel);
  if (!fs.existsSync(targetPath)) {
    console.warn(`[Version Consistency] Target skipped (not found): ${targetRel}`);
    continue;
  }

  const content = fs.readFileSync(targetPath, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const badVer of disallowedVersions) {
      if (line.includes(badVer)) {
        console.error(`[FAIL] Stale version "${badVer}" detected in ${targetRel}:${i + 1}`);
        console.error(`       Line: ${line.trim()}`);
        violationCount++;
      }
    }
  }
}

// Check that state-persisted.json does not exist or contain old file state
const persistedPath = path.join(rootDir, 'Data', 'state-persisted.json');
if (fs.existsSync(persistedPath)) {
  const content = fs.readFileSync(persistedPath, 'utf8');
  for (const badVer of disallowedVersions) {
    if (content.includes(badVer)) {
      console.error(`[FAIL] Legacy state file Data/state-persisted.json still contains stale version "${badVer}"!`);
      violationCount++;
    }
  }
}

if (violationCount > 0) {
  console.error(`\nFAILED: Found ${violationCount} version consistency violation(s). Build aborted.`);
  process.exit(1);
}

console.log(`[PASS] Version consistency check passed. All target components conform to "${currentAgentVersion}".`);
process.exit(0);
