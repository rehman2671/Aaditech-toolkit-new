# Phase N Stage 69 — read-only GitHub merger governance admission

**Status: OFFLINE CHECKER TESTED; LIVE GOVERNANCE BLOCKED; INDEPENDENT REVIEW AND PRODUCTION NOT APPROVED (2026-11-21 IST).**

## Observed external blocker

- `main` at `eaf24eb8e49c6883a376fe0cf5d864a2ed1dad86`: `protected=false`.
- GitHub repository rulesets list: **zero active rulesets**.
- PR #59, #60 and draft #61: **zero independent GitHub reviews**.
- This GitHub integration lacks branch protection administration permission; live classic protection inspection returned HTTP 403.
- The exact owner actions, eligible universal required CI contexts, human security reviewer handoff and N68 non-universal diagnostic limitation are recorded in [release-governance issue #62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62).

## New admission

`scripts/check-phase-n69-merge-governance.cjs` provides a **read-only** explicit `--live` check:
1. Require verified `main` commit, `protected=true`, an active main-target ruleset with no bypass actors, force-push/deletion protection, stale-review invalidation, non-author last-push review and resolved review threads.
2. Require five universal required GitHub Actions CI/deployment-safety checks in branch rulesets.
3. Require PR #59/#60/#61 to be open, non-draft, main-targeted, independently APPROVED on their exact latest heads, with no outstanding changes-requested reviews.
4. Require each PR's GitHub check-run metadata to show successful completion at its latest exact head for all five checks.
5. Fail closed if any GitHub API evidence is unavailable, incomplete, stale or inconclusive. Never set branch rules, sign, publish or approve on a reviewer's behalf.

Usage (run by an authorized maintainer with a **read-only** GitHub token permitted to inspect the repository):

```bash
GITHUB_REPOSITORY=rehman2671/Aaditech-toolkit-new GITHUB_TOKEN=YOUR_READ_ONLY_TOKEN node scripts/check-phase-n69-merge-governance.cjs --live
```

Do not commit or print real tokens. Synthetic native Node fixtures and fault-injection tests are run in `npm run lint`, separate from the live audit. An offline PASS **does not imply** the real repository is safe to merge.

## Technical acceptance and operational blockers

- [x] N68 actual unsigned Windows MSI compile, administrative extraction, install/uninstall and major-upgrade acceptance: [CI 44889704068](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44889704068) **4/4**; [safety 44889703995](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44889703995) **2/2**.
- [ ] N69 native audit tests pass on this PR head.
- [ ] Active protected `main` ruleset with non-author review and universal check policies established by authorized GitHub administrator.
- [ ] Actual independent APPROVED reviews on latest heads #59/#60/#61; integration draft marked ready; live N69 audit passes.
- [ ] Authorized merge, fresh `main` diagnostic MSI re-run, authentic signed publisher approval, protected GitHub Release publication, Hostinger TLS/server setup and physical Windows enrollment acceptance.

**This is an observation and review gate, not repository administration. No customer production approval.**
