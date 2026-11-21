'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, REQUIRED_PRS, REQUIRED_CHECKS, GITHUB_ACTIONS_APP_ID, ruleTargetsMain } = require('../../scripts/check-phase-n69-merge-governance.cjs');
const BASE_SHA = 'a'.repeat(40);
function fixture() {
  return {
    repository: { default_branch: 'main', full_name: 'rehman2671/Aaditech-toolkit-new' },
    branch: { name: 'main', protected: true, commit: { sha: BASE_SHA } },
    rulesets: [{ id: 1, enforcement: 'active', target: 'branch', bypass_actors: [],
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [
        { type: 'non_fast_forward' }, { type: 'deletion' },
        { type: 'pull_request', parameters: {
          required_approving_review_count: 1, dismiss_stale_reviews_on_push: true,
          require_last_push_approval: true, required_review_thread_resolution: true
        } },
        { type: 'required_status_checks', parameters: {
          required_status_checks: REQUIRED_CHECKS.map(context => ({ context, integration_id: GITHUB_ACTIONS_APP_ID }))
        } }
      ]
    }],
    prs: REQUIRED_PRS.map(number => {
      const sha = number.toString().repeat(40).slice(0,40);
      const fullName = 'rehman2671/Aaditech-toolkit-new';
      return { number, state: 'open', draft: false, base: { ref: 'main', repo: { full_name: fullName } },
        head: { sha, ref: 'integration/test-' + number, repo: { full_name: fullName } },
        user: { login: 'code-author' },
        reviews: [{ user: { login: 'independent-reviewer', type: 'User' }, state: 'APPROVED',
          commit_id: sha, submitted_at: '2026-11-21T12:00:00Z' }],
        check_runs: REQUIRED_CHECKS.map(name => {
          const safety = name.startsWith('Bash ') || name.startsWith('Isolated ');
          const runId = Number(number + (safety ? '02' : '01'));
          return { name, status: 'completed', conclusion: 'success', head_sha: sha,
            app: { id: GITHUB_ACTIONS_APP_ID, slug: 'github-actions' },
            details_url: 'https://github.com/' + fullName + '/actions/runs/' +
              runId + '/job/' + (runId + 100000),
            verified_workflow_run: {
              id: runId, event: 'pull_request', status: 'completed',
              conclusion: 'success', head_sha: sha, head_branch: 'integration/test-' + number,
              path: '.github/workflows/' + (safety ? 'deployment-safety.yml' : 'ci.yml'),
              repository: { full_name: fullName }, head_repository: { full_name: fullName }
            }
          };
        })
      };
    })
  };
}
function deny(mutate, label) {
  const data = fixture();
  mutate(data);
  const report = evaluate(data);
  assert.equal(report.readyForHumanMergeDecision, false, label);
  assert.ok(report.blockers.length > 0, label);
}
test('synthetic locked main and independently reviewed exact PR heads are eligible only for human decision', () => {
  const report = evaluate(fixture());
  assert.equal(report.readyForHumanMergeDecision, true, report.blockers.join('; '));
});
test('current observed unprotected and unreviewed GitHub state fails closed', () => {
  deny(d => { d.branch.protected = false; d.rulesets = []; d.prs.forEach(p => p.reviews = []); },
    'unprotected main and zero reviewers');
});
test('main-target, active and bypass-free branch rules required', () => {
  deny(d => d.repository.default_branch = 'development', 'unexpected default branch');
  deny(d => d.rulesets[0].enforcement = 'disabled', 'disabled ruleset');
  deny(d => d.rulesets[0].bypass_actors.push({ actor_id: 1 }), 'bypass');
  deny(d => d.rulesets[0].conditions.ref_name.exclude.push('refs/heads/main'), 'excluded main');
  deny(d => d.rulesets[0].conditions.ref_name.exclude.push('refs/heads/*'), 'wildcard main exclusion');
  assert.equal(ruleTargetsMain(fixture().rulesets[0]), true);
});
test('stale approvals, PR author self-reviews and later changes-requested fail', () => {
  deny(d => d.prs[0].reviews[0].commit_id = BASE_SHA, 'stale old head');
  deny(d => d.prs[0].reviews[0].user.login = 'code-author', 'self-approval');
  deny(d => d.prs[0].reviews[0].user.type = 'Bot', 'bot review');
  deny(d => d.prs[0].reviews[0].user.login = 'security[bot]', 'bot login');
  deny(d => d.prs[1].reviews.push({ user: { login: 'independent-reviewer' },
    state: 'CHANGES_REQUESTED', submitted_at: '2026-11-21T13:00:00Z' }),
    'later rejected PR');
  deny(d => d.prs[0].reviews.push({ user: { login: 'different-reviewer' },
    state: 'CHANGES_REQUESTED', submitted_at: '2026-11-21T13:00:00Z' }),
    'unresolved change request by another reviewer');
  deny(d => d.prs[0].draft = true, 'draft integration');
});
test('weak review configuration and missing force-push or delete rules fail', () => {
  deny(d => d.rulesets[0].rules[2].parameters.dismiss_stale_reviews_on_push = false,
    'stale approvals permitted');
  deny(d => d.rulesets[0].rules[2].parameters.required_approving_review_count = 0,
    'zero required reviewers');
  deny(d => d.rulesets[0].rules.splice(0,1), 'force push enabled');
  deny(d => d.rulesets[0].rules.splice(1,1), 'deletion enabled');
});
test('all required CI and safety checks must be both configured and successful on exact source', () => {
  deny(d => d.rulesets[0].rules[3].parameters.required_status_checks.pop(), 'lost required check');
  deny(d => d.prs[0].check_runs[0].conclusion = 'skipped', 'skipped check');
  deny(d => d.prs[0].check_runs[0].head_sha = BASE_SHA, 'stale check');
  deny(d => d.prs[2].check_runs = [], 'no integration checks');
  deny(d => d.rulesets[0].rules[3].parameters.required_status_checks[0].integration_id = 1,
    'wrong required-check GitHub Actions integration');
});

test('green status names cannot impersonate authentic GitHub Actions PR workflow evidence', () => {
  deny(d => d.prs[0].check_runs[0].app.id = 123, 'untrusted GitHub App');
  deny(d => d.prs[0].check_runs[0].app.slug = 'third-party-bot', 'untrusted App slug');
  deny(d => d.prs[0].check_runs[0].details_url =
    'https://attacker.example/check/5901', 'forged details URL');
  deny(d => d.prs[0].check_runs[0].verified_workflow_run.event =
    'workflow_dispatch', 'manual green run');
  deny(d => d.prs[0].check_runs[0].verified_workflow_run.path =
    '.github/workflows/attacker.yml', 'wrong workflow');
  deny(d => d.prs[0].check_runs[0].verified_workflow_run.head_sha =
    'f'.repeat(40), 'wrong source SHA');
  deny(d => d.prs[0].check_runs[0].verified_workflow_run.head_branch =
    'main', 'wrong source branch');
  deny(d => d.prs[0].head.repo.full_name = 'untrusted/fork', 'fork source');
  deny(d => d.prs[1].check_runs[3].verified_workflow_run.path =
    '.github/workflows/ci.yml', 'incorrect safety workflow');
});
