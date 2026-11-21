#!/usr/bin/env node
'use strict';
// N70: production-signing/publishing guard; read-only GitHub API.
// No cached approvals, insecure skips, user-provided URL or offline overrides.
const REQUIRED_CHECKS = Object.freeze([
  'PowerShell validation',
  'Node.js Unit & Integration Tests (Vitest + MySQL 8)',
  'API test suite (Node.js vs MySQL 8)',
  'Bash syntax and offline database recovery tests',
  'Isolated MySQL 8 backup and restore data integrity'
]);
const GH_APP_ID = 15368;
const SHA = /^[a-f0-9]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function mainTarget(rule) {
  if (!rule || rule.enforcement !== 'active' || rule.target !== 'branch') return false;
  const ref = rule.conditions?.ref_name;
  if (!Array.isArray(ref?.include) || !Array.isArray(ref?.exclude)) return false;
  const needles = ['~DEFAULT_BRANCH', '~ALL', 'refs/heads/main'];
  return ref.include.some(x => needles.includes(x)) && !ref.exclude.some(x => needles.includes(x));
}
function evaluate(snapshot, expectedSha, repoName) {
  const blockers = [];
  if (!REPO.test(repoName || '') || !SHA.test(expectedSha || '')) {
    blockers.push('invalid requested repository or release source');
  }
  if (snapshot?.repository?.full_name !== repoName ||
      snapshot?.repository?.default_branch !== 'main') {
    blockers.push('repository identity or default branch is not verified');
  }
  if (snapshot?.branch?.name !== 'main' || snapshot.branch.protected !== true ||
      snapshot.branch.commit?.sha !== expectedSha) {
    blockers.push('main is unprotected or current commit differs from approved workflow SHA');
  }
  const rulesets = Array.isArray(snapshot?.rulesets) ? snapshot.rulesets : [];
  const applicable = rulesets.filter(mainTarget);
  if (applicable.length === 0) blockers.push('no effective active main branch ruleset');
  if (applicable.some(r => !Array.isArray(r.bypass_actors) || r.bypass_actors.length !== 0)) {
    blockers.push('missing bypass evidence or bypass actor is allowed');
  }
  const all = applicable.flatMap(r => Array.isArray(r.rules) ? r.rules : []);
  if (!all.some(r => r.type === 'non_fast_forward') || !all.some(r => r.type === 'deletion')) {
    blockers.push('force-push and deletion prevention are incomplete');
  }
  if (!all.filter(r => r.type === 'pull_request').some(r => {
    const p = r.parameters;
    return Number.isInteger(p?.required_approving_review_count) &&
      p.required_approving_review_count >= 1 &&
      p.dismiss_stale_reviews_on_push === true &&
      p.require_last_push_approval === true &&
      p.required_review_thread_resolution === true;
  })) blockers.push('human latest-head PR review safeguards are incomplete');
  const configured = new Set(all.filter(r => r.type === 'required_status_checks')
    .flatMap(r => Array.isArray(r.parameters?.required_status_checks) ?
      r.parameters.required_status_checks : [])
    .filter(c => c && c.integration_id === GH_APP_ID)
    .map(c => c.context));
  for (const name of REQUIRED_CHECKS) {
    if (!configured.has(name)) blockers.push('missing required GitHub Actions CI check: ' + name);
  }
  return Object.freeze({ allowed: blockers.length === 0, blockers });
}
async function github(path, token) {
  const resp = await fetch('https://api.github.com' + path, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aaditech-n70-readonly-governance-audit',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer ' + token
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error('N70 cannot verify required GitHub governance metadata (HTTP ' + resp.status + ')');
  return resp.json();
}
async function readLiveSnapshot(repo, token) {
  if (!REPO.test(repo || '')) throw new Error('N70 requires an exact owner/repository identity');
  const prefix = '/repos/' + repo;
  const repository = await github(prefix, token);
  const branch = await github(prefix + '/branches/main', token);
  const summaries = await github(prefix + '/rulesets?includes_parents=true', token);
  if (!Array.isArray(summaries)) throw new Error('N70 invalid GitHub ruleset response');
  const rulesets = await Promise.all(summaries.map(async r => {
    if (!Number.isInteger(r.id)) throw new Error('N70 invalid ruleset identifier');
    return github(prefix + '/rulesets/' + r.id, token);
  }));
  return { repository, branch, rulesets };
}
async function live(repo, sha, token) {
  if (!REPO.test(repo || '') || !SHA.test(sha || '') ||
      typeof token !== 'string' || token.trim().length < 10) {
    throw new Error('N70 trusted source identity or read-only API credential missing');
  }
  return evaluate(await readLiveSnapshot(repo, token), sha, repo);
}
async function main(argv = process.argv) {
  if (argv[2] !== '--live' || argv.length !== 3 ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      process.env.GITHUB_REF !== 'refs/heads/main') {
    process.stderr.write('N70 BLOCKED: only protected manually dispatched main release workflows can verify production governance.\n');
    return 1;
  }
  try {
    const result = await live(process.env.GITHUB_REPOSITORY, process.env.GITHUB_SHA, process.env.GH_TOKEN);
    if (!result.allowed) {
      process.stderr.write('N70 BLOCKED: ' + result.blockers.join('; ') + '\n');
      return 1;
    }
    process.stdout.write('N70 VERIFIED: live main branch protection, non-bypassable independent review and trusted CI status policy.\n');
    return 0;
  } catch (err) {
    process.stderr.write('N70 BLOCKED: ' + (err instanceof Error ? err.message : 'unverified metadata') + '\n');
    return 1;
  }
}
if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
module.exports = { REQUIRED_CHECKS, GH_APP_ID, mainTarget, evaluate, readLiveSnapshot, live, main };
