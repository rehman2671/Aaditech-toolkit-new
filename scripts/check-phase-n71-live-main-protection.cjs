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
  // Fail closed on ANY exclude: it may be a glob matching main (e.g. refs/heads/*).
  return ref.include.some(x => needles.includes(x)) && ref.exclude.length === 0;
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
// N73: read all pages from a fixed trusted API origin, bounded and fail-closed.
const RULESET_PAGE_SIZE = 100;
const MAX_RULESET_PAGES = 5;
async function github(path, token) {
  const resp = await fetch('https://api.github.com' + path, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aaditech-n71-readonly-governance-audit',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer ' + token
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error('N71 cannot verify required GitHub governance metadata (HTTP ' + resp.status + ')');
  return { data: await resp.json(), link: resp.headers.get('link') || '' };
}
async function readRulesetIds(prefix, token) {
  const ids = new Set();
  for (let page = 1; page <= MAX_RULESET_PAGES; page++) {
    const { data, link } = await github(prefix + '/rulesets?includes_parents=true&per_page=' +
      RULESET_PAGE_SIZE + '&page=' + page, token);
    if (!Array.isArray(data) || data.length > RULESET_PAGE_SIZE) {
      throw new Error('N73 invalid GitHub ruleset page');
    }
    for (const entry of data) {
      if (!Number.isSafeInteger(entry?.id) || entry.id <= 0 || ids.has(entry.id)) {
        throw new Error('N73 invalid or repeated ruleset identifier');
      }
      ids.add(entry.id);
    }
    // Never follow an arbitrary URL from a Link header. A full page is
    // conservatively followed even if the server omitted its next link.
    const hasNext = /<[^>]+>\s*;\s*rel="next"/i.test(link);
    if (data.length < RULESET_PAGE_SIZE && !hasNext) return [...ids];
    if (data.length === 0) throw new Error('N73 empty nonterminal ruleset page');
  }
  throw new Error('N73 ruleset pagination limit reached; completeness unverified');
}
async function readLiveSnapshot(repo, token) {
  if (!REPO.test(repo || '')) throw new Error('N71 requires an exact owner/repository identity');
  const prefix = '/repos/' + repo;
  const { data: repository } = await github(prefix, token);
  const { data: branch } = await github(prefix + '/branches/main', token);
  const ids = await readRulesetIds(prefix, token);
  const rulesets = [];
  // Bounded concurrency; avoid an unbounded burst of API requests.
  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = await Promise.all(ids.slice(offset, offset + 10).map(async id => {
      const { data: detail } = await github(prefix + '/rulesets/' + id, token);
      if (!detail || detail.id !== id || !Array.isArray(detail.rules)) {
        throw new Error('N73 invalid or mismatched ruleset detail');
      }
      return detail;
    }));
    rulesets.push(...batch);
  }
  // Detect list changes during detail retrieval, including new inherited
  // rulesets. This is not an atomic GitHub policy snapshot.
  const finalIds = await readRulesetIds(prefix, token);
  if (ids.length !== finalIds.length || finalIds.some(id => !ids.includes(id))) {
    throw new Error('N73 ruleset membership changed during verification');
  }
  const { data: finalBranch } = await github(prefix + '/branches/main', token);
  if (branch?.name !== finalBranch?.name ||
      branch?.protected !== finalBranch?.protected ||
      branch?.commit?.sha !== finalBranch?.commit?.sha) {
    throw new Error('N73 main branch changed during governance verification');
  }
  return { repository, branch: finalBranch, rulesets };
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
module.exports = { REQUIRED_CHECKS, GH_APP_ID, mainTarget, evaluate, readLiveSnapshot, live, main };
