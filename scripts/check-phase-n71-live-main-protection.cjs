#!/usr/bin/env node
'use strict';
// N71: production-signing/publishing guard; read-only GitHub API.
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
  // N73: a wildcard/unknown symbolic ref might match main. Treat it as
  // potentially applicable instead of silently ignoring an additional
  // policy with bypass actors. Deliberately conservative: unrelated glob
  // policies can block signing until reviewed, but never authorize it.
  // Do not filter exclusions here: any exclusion on a candidate is a blocker.
  return ref.include.some(x =>
    typeof x === 'string' &&
    (needles.includes(x) || /[*?\[\]{}\\]/.test(x) || x.startsWith('~')));
}
// Only an EXACT, GitHub-documented scope is affirmative evidence of a
// protected main branch. A wildcard *may* match main and therefore must
// be audited for bypass, but cannot itself establish enforcement: e.g.
// refs/heads/release/* never covers main even if branch.protected is true
// due to a weaker, unrelated protection mechanism.
function confirmedMainTarget(rule) {
  if (!rule || rule.enforcement !== 'active' || rule.target !== 'branch') return false;
  const ref = rule.conditions?.ref_name;
  if (!Array.isArray(ref?.include) || !Array.isArray(ref?.exclude) ||
      ref.exclude.length !== 0) return false;
  return ref.include.some(x =>
    x === '~DEFAULT_BRANCH' || x === '~ALL' || x === 'refs/heads/main');
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
  const confirmed = applicable.filter(confirmedMainTarget);
  if (confirmed.length === 0) {
    blockers.push('no confirmed active main branch ruleset with exact main scope');
  }
  // Incomplete active branch metadata is not evidence that a ruleset is
  // unrelated to main. Neither are unreviewed excludes or malformed globs.
  if (rulesets.some(r => r?.enforcement === 'active' && r?.target === 'branch' &&
      (!Array.isArray(r.conditions?.ref_name?.include) ||
       !Array.isArray(r.conditions?.ref_name?.exclude) ||
       r.conditions.ref_name.include.some(x => typeof x !== 'string') ||
       r.conditions.ref_name.exclude.some(x => typeof x !== 'string')))) {
    blockers.push('active branch ruleset scope is incomplete or unverifiable');
  }
  if (applicable.some(r => r.conditions.ref_name.exclude.length !== 0)) {
    blockers.push('potential main ruleset has unapproved branch exclusions');
  }
  if (applicable.some(r => !Array.isArray(r.bypass_actors) || r.bypass_actors.length !== 0)) {
    blockers.push('missing bypass evidence or bypass actor is allowed');
  }
  // Only rulesets known to cover main may satisfy mandatory PR/review/status
  // safeguards; ambiguous wildcard policies are still audited for bypasses.
  const all = confirmed.flatMap(r => Array.isArray(r.rules) ? r.rules : []);
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
  // N72: five required GitHub Actions contexts must be part of at least
  // one SAME strictly up-to-date rule. A union of loose status rules across
  // multiple rulesets would accept stale-branch results. GitHub REST requires
  // strict_required_status_checks_policy=true for fresh target-branch checks.
  const statusRules = all.filter(r => r.type === 'required_status_checks' &&
    r.parameters?.strict_required_status_checks_policy === true);
  const complete = statusRules.some(r => {
    const checks = r.parameters?.required_status_checks;
    if (!Array.isArray(checks)) return false;
    const contexts = new Set(checks.filter(check =>
      check && check.integration_id === GH_APP_ID &&
      typeof check.context === 'string').map(check => check.context));
    return REQUIRED_CHECKS.every(name => contexts.has(name));
  });
  if (!complete) {
    blockers.push('five trusted GitHub Actions checks are not enforced together with strict up-to-date policy');
  }
  return Object.freeze({ allowed: blockers.length === 0, blockers });
}
async function github(path, token) {
  const resp = await fetch('https://api.github.com' + path, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aaditech-n71-readonly-governance-audit',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer ' + token
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error('N71 cannot verify required GitHub governance metadata (HTTP ' + resp.status + ')');
  return resp.json();
}
// GitHub paginates repository rulesets. A first-page-only inspection is not
// admissible for protected signing: a later page could hide a main bypass.
// Reject truncated/duplicate/inconsistent responses instead of assuming safety.
const RULESET_PAGE_SIZE = 100;
const MAX_RULESET_PAGES = 10;
// A ruleset list and individual rule details are not an atomic GitHub
// snapshot. Read them twice; do not bless a policy changed mid-verification.
// Both passes are bounded and any disagreement denies production admission.
async function readPolicyInventory(prefix, token, request) {
  const summaries = [];
  const seenIds = new Set();
  for (let page = 1; page <= MAX_RULESET_PAGES; page++) {
    const batch = await request(prefix +
      '/rulesets?includes_parents=true&per_page=' + RULESET_PAGE_SIZE + '&page=' + page, token);
    if (!Array.isArray(batch) || batch.length > RULESET_PAGE_SIZE) {
      throw new Error('N73 incomplete or invalid GitHub ruleset page');
    }
    for (const item of batch) {
      if (!Number.isSafeInteger(item?.id) || item.id <= 0 || seenIds.has(item.id)) {
        throw new Error('N73 missing or duplicate GitHub ruleset identifier');
      }
      seenIds.add(item.id);
      summaries.push(item);
    }
    if (batch.length < RULESET_PAGE_SIZE) break;
    if (page === MAX_RULESET_PAGES) {
      throw new Error('N73 GitHub ruleset page limit exceeded; governance cannot be proven');
    }
  }
  const rulesets = [];
  // Bounded fetch concurrency avoids unbounded fan-out on large repositories.
  for (let offset = 0; offset < summaries.length; offset += 10) {
    const part = summaries.slice(offset, offset + 10);
    const details = await Promise.all(part.map(item =>
      request(prefix + '/rulesets/' + item.id, token)));
    for (let i = 0; i < part.length; i++) {
      if (!details[i] || details[i].id !== part[i].id) {
        throw new Error('N73 ruleset details do not match enumerated policy identity');
      }
      rulesets.push(details[i]);
    }
  }
  return { summaries, rulesets };
}
async function readLiveSnapshot(repo, token, request = github) {
  if (!REPO.test(repo || '')) throw new Error('N71 requires an exact owner/repository identity');
  const prefix = '/repos/' + repo;
  const originalRepository = await request(prefix, token);
  const originalBranch = await request(prefix + '/branches/main', token);
  const initial = await readPolicyInventory(prefix, token, request);
  const confirmed = await readPolicyInventory(prefix, token, request);
  // GitHub responses are JSON; compare complete policy evidence rather than
  // just IDs or a few approved settings. Even reordering fails closed.
  if (JSON.stringify(initial) !== JSON.stringify(confirmed)) {
    throw new Error('N73 main governance ruleset inventory changed during verification');
  }
  // Check the branch last so a main push or protection change during the
  // policy reads is not accepted based on the initial branch snapshot.
  const branch = await request(prefix + '/branches/main', token);
  const repository = await request(prefix, token);
  if (originalRepository?.full_name !== repository?.full_name ||
      originalRepository?.default_branch !== repository?.default_branch ||
      originalBranch?.name !== branch?.name ||
      originalBranch?.protected !== branch?.protected ||
      originalBranch?.commit?.sha !== branch?.commit?.sha) {
    throw new Error('N73 main branch or repository changed during governance verification');
  }
  return { repository, branch, rulesets: confirmed.rulesets };
}
async function live(repo, sha, token) {
  if (!REPO.test(repo || '') || !SHA.test(sha || '') ||
      typeof token !== 'string' || token.trim().length < 10) {
    throw new Error('N71 trusted source identity or read-only API credential missing');
  }
  return evaluate(await readLiveSnapshot(repo, token), sha, repo);
}
async function main(argv = process.argv) {
  if (argv[2] !== '--live' || argv.length !== 3 ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      process.env.GITHUB_REF !== 'refs/heads/main') {
    process.stderr.write('N71 BLOCKED: only protected manually dispatched main release workflows can verify production governance.\n');
    return 1;
  }
  try {
    const result = await live(process.env.GITHUB_REPOSITORY, process.env.GITHUB_SHA, process.env.GH_TOKEN);
    if (!result.allowed) {
      process.stderr.write('N71 BLOCKED: ' + result.blockers.join('; ') + '\n');
      return 1;
    }
    process.stdout.write('N71 VERIFIED: live main branch protection, non-bypassable independent review and trusted CI status policy.\n');
    return 0;
  } catch (err) {
    process.stderr.write('N71 BLOCKED: ' + (err instanceof Error ? err.message : 'unverified metadata') + '\n');
    return 1;
  }
}
if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
module.exports = { REQUIRED_CHECKS, GH_APP_ID, mainTarget, confirmedMainTarget, evaluate, readLiveSnapshot, live, main };
