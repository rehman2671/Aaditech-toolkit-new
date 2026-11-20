'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { APPROVED, checkWorkflowText, checkWorkflows } = require('../../scripts/check-github-actions-pins.cjs');
test('checked-in workflows use only exact reviewed action SHAs', () => {
  const result = checkWorkflows();
  assert.ok(result.workflowCount >= 4);
  assert.ok(result.actionCount >= 10);
});
test('exact approved SHA with trailing comment accepted', () => {
  assert.equal(checkWorkflowText('steps:\n - uses: actions/checkout@' +
    APPROVED['actions/checkout'] + ' # version reviewed'), 1);
});
test('moving tags, bad SHAs, unknown actions and expressions rejected', () => {
  const tokens = [
    'actions/checkout@v4', 'actions/checkout@main',
    'actions/checkout@11d5960', 'actions/checkout@' + '0'.repeat(40),
    'unknown/action@' + APPROVED['actions/checkout'],
    'actions/download-artifact@' + APPROVED['actions/upload-artifact'],
    'actions/checkout@' + '$' + '{{ github.ref }}',
    'actions/checkout@' + APPROVED['actions/checkout'].toUpperCase()
  ];
  for (const value of tokens) {
    assert.throws(() => checkWorkflowText('steps:\n - uses: ' + value),
      /N65 moving or unapproved action/, value);
  }
});
test('folded and invalid YAML uses values fail closed', () => {
  for (const value of ['>', '', 'actions/checkout@v4 extra']) {
    assert.throws(() => checkWorkflowText('steps:\n - uses: ' + value), /N65 /);
  }
});
test('empty and non-string workflow payloads fail closed', () => {
  assert.throws(() => checkWorkflowText(''), /N65 invalid/);
  assert.throws(() => checkWorkflowText(null), /N65 invalid/);
});
