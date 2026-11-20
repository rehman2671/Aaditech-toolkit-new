#!/usr/bin/env node
'use strict';
// Phase N65: pin external action code in every workflow; refuse moving refs.
const fs = require('node:fs');
const path = require('node:path');
const APPROVED = Object.freeze({
  'actions/checkout': '11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node': '49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/download-artifact': 'd3f86a106a0bac45b974a628896c90dbdf5c8093'
});
function checkWorkflowText(input, label = 'workflow') {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2097152) {
    throw new Error('N65 invalid workflow text: ' + label);
  }
  let count = 0;
  for (const [i, line] of input.split(/\r?\n/).entries()) {
    if (!/^\s*(?:-\s*)?uses\s*:/.test(line)) continue;
    const match = /^\s*(?:-\s*)?uses\s*:\s*(\S+)\s*(?:#.*)?$/.exec(line);
    if (!match) throw new Error('N65 unsafe uses syntax: ' + label + ':' + (i + 1));
    const value = /^([a-z0-9-]+\/[a-z0-9-]+)@([0-9a-f]{40})$/.exec(match[1]);
    if (!value || APPROVED[value[1]] !== value[2]) {
      throw new Error('N65 moving or unapproved action: ' + label + ':' + (i + 1));
    }
    count++;
  }
  return count;
}
function checkWorkflows(repoRoot = path.resolve(__dirname, '..')) {
  const dir = path.join(repoRoot, '.github', 'workflows');
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.name.endsWith('.yml') || e.name.endsWith('.yaml'));
  if (entries.length === 0) throw new Error('N65 workflows missing.');
  let actionCount = 0;
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('N65 workflow is not a regular file: ' + entry.name);
    }
    const file = path.join(dir, entry.name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 2097152) {
      throw new Error('N65 malformed workflow file: ' + entry.name);
    }
    actionCount += checkWorkflowText(fs.readFileSync(file, 'utf8'), entry.name);
  }
  if (!actionCount) throw new Error('N65 no checked Actions found.');
  return { workflowCount: entries.length, actionCount };
}
if (require.main === module) {
  const result = checkWorkflows();
  process.stdout.write('N65 PASS: ' + result.actionCount +
    ' immutable approved action references in ' + result.workflowCount + ' workflows.\n');
}
module.exports = { APPROVED, checkWorkflowText, checkWorkflows };
