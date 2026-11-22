# AadiTech — GitHub `main` ruleset administrator handoff

**Owner action required. Production signing remains BLOCKED until verification.**

This is a non-secret, reviewed proposal. Current live repository evidence as of **2026-11-23 IST**: `main.protected=false`, no effective rulesets, no manually signed CI run, no published production Windows installer. This guide does **not** claim those conditions have changed.

## Pre-apply requirements

1. An authorized repository administrator must independently approve this exact ruleset and make sure at least **two distinct human contributors** with suitable repository access are available: the code pusher and an independent reviewer. Otherwise requiring a latest-push review can intentionally block future merges.
2. Verify the current GitHub Actions source of the five required status contexts: `PowerShell validation`, `Node.js Unit & Integration Tests (Vitest + MySQL 8)`, `API test suite (Node.js vs MySQL 8)`, `Bash syntax and offline database recovery tests`, `Isolated MySQL 8 backup and restore data integrity`. They must each come from the official **GitHub Actions** app, integration ID `15368`, with a successful **current** PR head.
3. An admin must confirm the repo plan/account supports **actively enforced** rulesets. A draft/evaluation-only ruleset is not enough. The GitHub API mutation endpoint requires repository **Administration (write)** permission; do not paste a token into chat, build logs, or any file tracked by Git.
4. Confirm no overlapping or contradictory branch rulesets are already configured (including inherited rules). Review all bypass actors and the **effective** protection after activation. A ruleset with bypass actors or exceptions cannot satisfy N71 production authorization.
5. Review the proposed repository-owned code and tests on a protected branch **before** applying. No automated merges or publish jobs should be run as part of initial setup.

## Generate the exact proposal (no API/network write)

In a locally trusted working copy:

```powershell
git switch main
git pull --ff-only
npm ci
npm run lint
node scripts/build-phase-n72-main-ruleset.cjs --json > "$env:TEMP\aaditech-main-ruleset-proposal.json"
```

The output has **zero credentials**. Review the generated JSON: active `branch` ruleset scoped to `refs/heads/main`, no exclusions, no bypass actors, no deletion or force push, one independent latest-push approving review with stale approval dismissal and resolved conversations, all **five** GitHub Actions contexts in a **single** strictly up-to-date required-check rule. Its status-check integration ID is fixed to `15368`. Merge commits remain allowed.

**Do not apply automatically from CI.** Once an authorized administrator and independent reviewer have approved the payload, that administrator can apply it locally through GitHub UI Settings → Rules → Rulesets, or with their own appropriately scoped `gh` credentials:

```powershell
gh auth status
gh api --method POST "repos/rehman2671/Aaditech-toolkit-new/rulesets" --input "$env:TEMP\aaditech-main-ruleset-proposal.json"
```

If the repository plan rejects the rule or returns HTTP 4xx, **stop**: do not create a weaker rule. Never export the administrator token to a GitHub Actions job.

## Verify the effective live state

```powershell
gh api "repos/rehman2671/Aaditech-toolkit-new/branches/main" --jq '.protected'
gh api "repos/rehman2671/Aaditech-toolkit-new/rulesets?includes_parents=true"
```

The first command must return `true`. An administrator must inspect the full actual ruleset (including `bypass_actors=[]`) and verify all required contexts and latest-push approval settings. **Do not** accept a `protected=true` flag by itself.

To verify that protection actually enforces on PRs, have a different collaborator create a **harmless non-release PR** from a branch and confirm the five CI statuses run; check that unapproved merge and force-push are refused. Independent review then permits a normal merge.

## Important: GitHub API disclosure/credential boundary

GitHub's REST API documentation says `bypass_actors` is returned only to an actor with **write access to the ruleset**. A standard GitHub Actions `GITHUB_TOKEN` may therefore lack the data N71 requires, even when `main` is protected. That is **intentional fail-closed behavior**, not a reason to omit bypass checks.

Before attempting a signed release, the release-security owner must design an **independently reviewed trusted governance attestation** or dedicated narrowly-scoped trusted verifier with adequate permissions. **Do not add a repository Administration-write token or owner PAT to the general Windows build/signing job merely to bypass this limitation.** CI-only mocked governance acceptance does not prove a live read can succeed.

Any missing required policy, unverified bypass list, denied API permission, main SHA drift or independently unapproved release must block production signing/publication. N71's runtime gate remains intact.

## Production dependencies after GitHub protection

This step does **not** supply independent SHA approval of exact compiler packages/SQLite artifacts, reviewer-signed manifest, commercial code-signing certificate, Hostinger VPS/domain/DNS/TLS, physical Windows tenant enrolment, or independently verified encrypted offsite MySQL restore. See [Production release checklist](PHASE-N-PRODUCTION-RELEASE-CHECKLIST.md) and [governance issue #62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62).
