#!/usr/bin/env node
'use strict';

// N69: read-only, fail-closed human governance gate. Does not protect GitHub
// branches or approve a release. Audit before ANY security PR merge.
const REQUIRED_PRS = Object.freeze([59, 60, 61]);
const REQUIRED_CHECKS = Object.freeze([
  'PowerShell validation',
  'Node.js Unit & Integration Tests (Vitest + MySQL 8)',
  'API test suite (Node.js vs MySQL 8)',
  'Bash syntax and offline database recovery tests',
  'Isolated MySQL 8 backup and restore data integrity'
]);
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_ACTIONS_APP_ID = 15368; // Official GitHub Actions app, verified by CI API.
const CHECK_DETAIL = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)\/actions\/runs\/([1-9]\d*)\/job\/([1-9]\d*)$/;
const SAFETY_CHECKS = new Set([
  'Bash syntax and offline database recovery tests',
  'Isolated MySQL 8 backup and restore data integrity'
]);

function ruleTargetsMain(ruleset) {
  if (!ruleset || ruleset.enforcement !== 'active' || ruleset.target !== 'branch') return false;
  const ref = ruleset.conditions?.ref_name;
  if (!ref || !Array.isArray(ref.include) || !Array.isArray(ref.exclude)) return false;
  const applicable = ['~DEFAULT_BRANCH', '~ALL', 'refs/heads/main'];
  // Any exclusion may be a wildcard covering main; never guess applicability.
  return ref.include.some(p => applicable.includes(p)) && ref.exclude.length === 0;
}

function normalizedContext(context) {
  if (typeof context !== 'string') return '';
  // GitHub Actions UI sometimes displays the workflow prefix.
  return context.replace(/^(?:CI|Deployment safety regression) \/ /, '');
}

function latestApprovedReview(pr) {
  const author = pr?.user?.login;
  const head = pr?.head?.sha;
  if (!author || !SHA.test(head || '') || !Array.isArray(pr.reviews)) return false;
  const latest = new Map();
  for (const item of [...pr.reviews].sort((a, b) =>
    String(a.submitted_at || '').localeCompare(String(b.submitted_at || '')))) {
    const login = item?.user?.login;
    if (!login || item.state === 'COMMENTED' || item.state === 'PENDING') continue;
    if (['APPROVED', 'DISMISSED', 'CHANGES_REQUESTED'].includes(item.state)) {
      latest.set(login, item);
    }
  }
  // A remaining CHANGES_REQUESTED review must never be hidden by a different
  // reviewer's approval. GitHub also blocks such merges by policy.
  if ([...latest.values()].some(review => review.state === 'CHANGES_REQUESTED')) return false;
  return [...latest.entries()].some(([reviewer, review]) =>
    reviewer !== author && review.user?.type === 'User' &&
    !reviewer.endsWith('[bot]') && review.state === 'APPROVED' && review.commit_id === head);
}

function isTrustedCheck(check, name, pr, repositoryName) {
  if (!check || !repositoryName || normalizedContext(check.name) !== name ||
      check.status !== 'completed' || check.conclusion !== 'success' ||
      check.head_sha !== pr.head.sha ||
      check.app?.id !== GITHUB_ACTIONS_APP_ID ||
      check.app?.slug !== 'github-actions') return false;
  const match = CHECK_DETAIL.exec(String(check.details_url || ''));
  const run = check.verified_workflow_run;
  const workflow = SAFETY_CHECKS.has(name) ?
    '.github/workflows/deployment-safety.yml' : '.github/workflows/ci.yml';
  return Boolean(match && match[1] === repositoryName && run &&
    String(run.id) === match[2] && run.event === 'pull_request' &&
    run.status === 'completed' && run.conclusion === 'success' &&
    run.path === workflow &&
    run.repository?.full_name === repositoryName &&
    run.head_repository?.full_name === repositoryName &&
    run.head_sha === pr.head.sha && run.head_branch === pr.head.ref);
}

function evaluate(snapshot) {
  const blockers = [];
  const branch = snapshot?.branch;
  const repoName = snapshot?.repository?.full_name;
  if (!REPO.test(repoName || '')) blockers.push('repository identity is missing or unverified');
  if (snapshot?.repository?.default_branch !== 'main') {
    blockers.push('repository default branch is not verified as main');
  }
  if (branch?.name !== 'main' || branch.protected !== true || !SHA.test(branch?.commit?.sha || '')) {
    blockers.push('main protection is missing or its source identity is unverified');
  }
  const rulesets = Array.isArray(snapshot?.rulesets) ? snapshot.rulesets : [];
  const active = rulesets.filter(ruleTargetsMain);
  if (active.length === 0) blockers.push('no active branch ruleset demonstrably targets main');
  if (active.some(r => Array.isArray(r.bypass_actors) && r.bypass_actors.length > 0)) {
    blockers.push('main ruleset contains bypass actors');
  }
  const rules = active.flatMap(r => Array.isArray(r.rules) ? r.rules : []);
  const pullRule = rules.filter(r => r.type === 'pull_request').map(r => r.parameters || {});
  if (!pullRule.some(p => Number.isInteger(p.required_approving_review_count) &&
    p.required_approving_review_count >= 1 && p.dismiss_stale_reviews_on_push === true &&
    p.require_last_push_approval === true && p.required_review_thread_resolution === true)) {
    blockers.push('required independent PR review and stale-approval protections not established');
  }
  if (!rules.some(r => r.type === 'non_fast_forward') ||
      !rules.some(r => r.type === 'deletion')) {
    blockers.push('branch force-push or deletion prevention not established');
  }
  const statuses = new Set(rules.filter(r => r.type === 'required_status_checks')
    .flatMap(r => Array.isArray(r.parameters?.required_status_checks) ?
      r.parameters.required_status_checks : [])
    .filter(c => c && c.integration_id === GITHUB_ACTIONS_APP_ID)
    .map(c => normalizedContext(c.context)));
  for (const name of REQUIRED_CHECKS) {
    if (!statuses.has(name)) blockers.push('required main status check not configured: ' + name);
  }
  const prs = Array.isArray(snapshot?.prs) ? snapshot.prs : [];
  for (const number of REQUIRED_PRS) {
    const pr = prs.find(p => p && p.number === number);
    if (!pr || pr.state !== 'open' || pr.draft !== false ||
        pr.base?.ref !== 'main' || !SHA.test(pr.head?.sha || '') ||
        pr.head?.repo?.full_name !== repoName || pr.base?.repo?.full_name !== repoName) {
      blockers.push('PR #' + number + ' must be an open, non-draft main-target review candidate');
      continue;
    }
    if (!latestApprovedReview(pr)) {
      blockers.push('PR #' + number + ' lacks independent approval on its exact latest head');
    }
    const runs = Array.isArray(pr.check_runs) ? pr.check_runs : [];
    for (const name of REQUIRED_CHECKS) {
      const matching = runs.filter(c => normalizedContext(c?.name) === name);
      if (!matching.some(c => isTrustedCheck(c, name, pr, repoName))) {
        blockers.push('PR #' + number + ' lacks successful latest-head check: ' + name);
      }
    }
  }
  return Object.freeze({ readyForHumanMergeDecision: blockers.length === 0, blockers });
}

async function getGithub(path, token) {
  const resp = await fetch('https://api.github.com' + path, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aaditech-n69-readonly-governance-audit',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error('N69 cannot verify required GitHub governance metadata (HTTP ' + resp.status + ')');
  return resp.json();
}

async function readLiveSnapshot(repo, token) {
  if (!REPO.test(repo || '')) throw new Error('N69 requires an exact owner/repository identity');
  const prefix = '/repos/' + repo;
  const repository = await getGithub(prefix, token);
  const branch = await getGithub(prefix + '/branches/main', token);
  const summaries = await getGithub(prefix + '/rulesets?includes_parents=true', token);
  if (!Array.isArray(summaries)) throw new Error('N69 invalid GitHub ruleset response');
  const rulesets = await Promise.all(summaries.map(async r => {
    if (!Number.isInteger(r.id)) throw new Error('N69 invalid ruleset identifier');
    return getGithub(prefix + '/rulesets/' + r.id, token);
  }));
  const actionRunCache = new Map();
  const prs = await Promise.all(REQUIRED_PRS.map(async number => {
    const pr = await getGithub(prefix + '/pulls/' + number, token);
    const reviews = await getGithub(prefix + '/pulls/' + number + '/reviews?per_page=100', token);
    const checks = await getGithub(prefix + '/commits/' + pr.head.sha + '/check-runs?per_page=100', token);
    if (!Array.isArray(reviews) || !Array.isArray(checks.check_runs) ||
        checks.total_count > checks.check_runs.length || reviews.length >= 100) {
      throw new Error('N69 incomplete review or required check pagination');
    }
    const trustedChecks = await Promise.all(checks.check_runs.map(async check => {
      if (!REQUIRED_CHECKS.includes(normalizedContext(check.name))) return check;
      const match = CHECK_DETAIL.exec(String(check.details_url || ''));
      if (!match || match[1] !== repo) return check;
      const runId = match[2];
      if (!actionRunCache.has(runId)) {
        actionRunCache.set(runId, getGithub(prefix + '/actions/runs/' + runId, token));
      }
      return { ...check, verified_workflow_run: await actionRunCache.get(runId) };
    }));
    return { ...pr, reviews, check_runs: trustedChecks };
  }));
  return { repository, branch, rulesets, prs };
}

async function main(argv = process.argv) {
  if (argv[2] !== '--live') {
    process.stderr.write('N69 usage: GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=<read-only-token> node scripts/check-phase-n69-merge-governance.cjs --live\n');
    return 2;
  }
  try {
    const snapshot = await readLiveSnapshot(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN);
    const report = evaluate(snapshot);
    if (!report.readyForHumanMergeDecision) {
      process.stderr.write('N69 BLOCKED: ' + report.blockers.join('; ') + '\n');
      return 1;
    }
    process.stdout.write('N69 VERIFIED: required repository governance and recorded latest-head approvals/checks. Human merge decision still required.\n');
    return 0;
  } catch (err) {
    process.stderr.write('N69 BLOCKED: ' + (err instanceof Error ? err.message : 'unverified metadata') + '\n');
    return 1;
  }
}
if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
module.exports = { REQUIRED_PRS, REQUIRED_CHECKS, GITHUB_ACTIONS_APP_ID, ruleTargetsMain, latestApprovedReview, isTrustedCheck, evaluate, readLiveSnapshot, main };
