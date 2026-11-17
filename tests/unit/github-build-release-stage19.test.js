import { describe, it, expect, vi } from 'vitest';
import { approvedGithubBuildConfig, readApprovedBuildStatus, dispatchApprovedBuild }
  from '../../github-build-release.js';

describe('Stage N19 trusted GitHub release control', () => {
  const config = { GITHUB_ACTIONS_REPO: 'rehman2671/Aaditech-toolkit-new',
    GITHUB_ACTIONS_TOKEN: 'example-fine-grained-token-for-tests' };
  it('fails closed without explicit operator repository and separate PAT', () => {
    expect(approvedGithubBuildConfig({})).toBeNull();
    expect(approvedGithubBuildConfig({ ...config, GITHUB_ACTIONS_REPO: '' })).toBeNull();
    expect(approvedGithubBuildConfig({ ...config, GITHUB_ACTIONS_REPO: '../evil' })).toBeNull();
    expect(approvedGithubBuildConfig({ ...config, GITHUB_ACTIONS_REPO: 'x/y?role=admin' })).toBeNull();
    expect(approvedGithubBuildConfig({ ...config, GITHUB_ACTIONS_TOKEN: '' })).toBeNull();
    expect(approvedGithubBuildConfig(config)).toMatchObject({ repo: 'rehman2671/Aaditech-toolkit-new', branch: 'main' });
  });
  it('does not dispatch or claim success when unconfigured', async () => {
    const sender = vi.fn();
    expect(await dispatchApprovedBuild(null, sender))
      .toEqual({ dispatched: false, reason: 'GITHUB_ACTIONS_NOT_CONFIGURED' });
    expect(sender).not.toHaveBeenCalled();
    expect(await readApprovedBuildStatus(null, sender)).toEqual({
      available: false, state: 'NOT_CONFIGURED', conclusion: null, html_url: null
    });
  });
  it('pins remote host/repo/ref and omits user supplied credentials', async () => {
    const fetcher = vi.fn(async () => ({ status: 204, ok: true }));
    const result = await dispatchApprovedBuild(approvedGithubBuildConfig(config), fetcher);
    expect(result).toMatchObject({ dispatched: true, branch: 'main' });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, opts] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/rehman2671/Aaditech-toolkit-new/actions/workflows/ci.yml/dispatches');
    expect(JSON.parse(opts.body)).toEqual({ ref: 'main' });
    expect(opts.headers.Authorization).toBe('Bearer ' + config.GITHUB_ACTIONS_TOKEN);
    expect(opts.redirect).toBe('error');
  });
  it('rejects non-204 and network failures; status is never fabricated success', async () => {
    const conf = approvedGithubBuildConfig(config);
    expect((await dispatchApprovedBuild(conf, async () => ({ status: 403, ok: false }))).dispatched).toBe(false);
    expect((await dispatchApprovedBuild(conf, async () => { throw new Error('offline'); })).dispatched).toBe(false);
    const noRuns = await readApprovedBuildStatus(conf, async () => ({
      ok: true, json: async () => ({ workflow_runs: [] })
    }));
    expect(noRuns.conclusion).toBeNull();
    expect(noRuns.state).toBe('NO_RUNS');
  });
});
