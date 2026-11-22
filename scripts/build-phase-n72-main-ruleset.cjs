#!/usr/bin/env node
'use strict';
// N72: deterministic OFFLINE proposal for a repository administrator.
// This tool never calls GitHub, never asks for credentials and NEVER
// creates/updates protections itself. Admin applies after independent review.
const { REQUIRED_CHECKS, GH_APP_ID, evaluate } =
  require('./check-phase-n71-live-main-protection.cjs');
const REPO = 'rehman2671/Aaditech-toolkit-new';
const SYNTHETIC_SHA = 'a'.repeat(40);

function buildMainRuleset() {
  return {
    name: 'AadiTech protected main — independent review + five security checks',
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: {
      ref_name: { include: ['refs/heads/main'], exclude: [] }
    },
    rules: [
      { type: 'non_fast_forward' },
      { type: 'deletion' },
      {
        type: 'pull_request',
        parameters: {
          allowed_merge_methods: ['merge'],
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: true,
          required_approving_review_count: 1,
          required_review_thread_resolution: true
        }
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: REQUIRED_CHECKS.map(context => ({
            context, integration_id: GH_APP_ID
          }))
        }
      }
    ]
  };
}

function validateProposal(proposal) {
  // Keep the template exact; additional fields/bypass/renamed contexts
  // must be reviewed in source and do not silently pass into an admin apply.
  const expected = buildMainRuleset();
  if (JSON.stringify(proposal) !== JSON.stringify(expected)) {
    throw new Error('N72 repository ruleset payload differs from reviewed exact proposal.');
  }
  const proof = evaluate({
    repository: { full_name: REPO, default_branch: 'main' },
    branch: { name: 'main', protected: true, commit: { sha: SYNTHETIC_SHA } },
    rulesets: [proposal]
  }, SYNTHETIC_SHA, REPO);
  if (!proof.allowed) {
    throw new Error('N72 proposal does not satisfy current N71 production gate.');
  }
  return true;
}

if (require.main === module) {
  try {
    const proposal = buildMainRuleset();
    validateProposal(proposal);
    if (process.argv.length !== 2 && (process.argv.length !== 3 ||
        process.argv[2] !== '--json')) {
      throw new Error('Usage: node scripts/build-phase-n72-main-ruleset.cjs [--json]');
    }
    process.stdout.write(JSON.stringify(proposal,null,2)+'\n');
  } catch (_) {
    process.stderr.write('N72 main ruleset proposal blocked. No GitHub settings changed.\n');
    process.exitCode = 1;
  }
}

module.exports = { buildMainRuleset, validateProposal, REPO };
