// Production workflow dispatch: credentials and destination are always server-owned.
// Never accept repo, ref or authentication token from an HTTP request or branding.
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

export function approvedGithubBuildConfig(env = process.env) {
  const repo = String(env.GITHUB_ACTIONS_REPO || '').trim();
  const token = String(env.GITHUB_ACTIONS_TOKEN || '').trim();
  if (!REPO_PATTERN.test(repo) || repo.includes('..') ||
      !token || token.length < 20 || /\s/.test(token)) return null;
  return { repo, token, branch: 'main' };
}

function apiHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Aaditech-Release-Controller',
    'Content-Type': 'application/json'
  };
}

export async function readApprovedBuildStatus(config, fetcher = fetch) {
  if (!config) return { available: false, state: 'NOT_CONFIGURED', conclusion: null, html_url: null };
  try {
    const response = await fetcher(
      'https://api.github.com/repos/' + config.repo + '/actions/workflows/ci.yml/runs?branch=main&per_page=1',
      { headers: apiHeaders(config.token), redirect: 'error', signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) return { available: true, state: 'UPSTREAM_UNAVAILABLE', conclusion: null,
      html_url: 'https://github.com/' + config.repo + '/actions' };
    const data = await response.json();
    const run = data.workflow_runs?.[0];
    if (!run) return { available: true, state: 'NO_RUNS', conclusion: null,
      html_url: 'https://github.com/' + config.repo + '/actions' };
    return {
      available: true,
      state: String(run.status || 'unknown'),
      conclusion: run.conclusion || null,
      run_number: Number(run.run_number) || null,
      html_url: /^https:\/\/github\.com\//.test(String(run.html_url || ''))
        ? run.html_url : 'https://github.com/' + config.repo + '/actions'
    };
  } catch {
    return { available: true, state: 'NETWORK_UNAVAILABLE', conclusion: null,
      html_url: 'https://github.com/' + config.repo + '/actions' };
  }
}

export async function dispatchApprovedBuild(config, fetcher = fetch) {
  if (!config) return { dispatched: false, reason: 'GITHUB_ACTIONS_NOT_CONFIGURED' };
  try {
    const response = await fetcher(
      'https://api.github.com/repos/' + config.repo + '/actions/workflows/ci.yml/dispatches',
      { method: 'POST', headers: apiHeaders(config.token),
        body: JSON.stringify({ ref: 'main' }),
        redirect: 'error', signal: AbortSignal.timeout(8000) }
    );
    if (response.status === 204) return { dispatched: true, repo: config.repo, branch: 'main' };
    return { dispatched: false, reason: 'GITHUB_WORKFLOW_NOT_ACCEPTED' };
  } catch {
    return { dispatched: false, reason: 'GITHUB_WORKFLOW_UNREACHABLE' };
  }
}
