# Phase N Stage 71 — universal deployment safety required checks

**Implementation candidate only. CI and independent human acceptance must still finish.**

## Issue corrected

Before N71 the deployment safety workflow used `paths` filters for both `push` and `pull_request`. That contradicted the five universal status contexts proposed for protected `main` in issue #62. A PR updating an unrelated source file could have a required deployment-safety check permanently pending because the entire workflow was never triggered. Main-branch changes could also omit a fresh backup/restore rehearsal.

## Implementation

- Deployment safety now runs on **every PR targeting `main`**, **every `main` push**, and manual workflow dispatch. Path filters are removed from the safety workflow.
- Preserve the exact two established status names: `Bash syntax and offline database recovery tests` and `Isolated MySQL 8 backup and restore data integrity`.
- N71 YAML-structural regression checks fail closed if path/tag/event filters are reintroduced, target main is changed, jobs become conditional/continue-on-error, commands are replaced, job names drift, or the job token exceeds read-only contents access.
- This necessarily increases Linux CI resource consumption, in exchange for reliable universal required checks and fresh protection evidence. N68 unsigned Windows MSI remains integration-PR-only and must **not** be a universal required status context.

## Acceptance

- [ ] Latest branch `npm run lint`, Windows security, Node/Vitest/MySQL, API/MySQL, and real unsigned Windows MSI integration successful.
- [ ] Latest branch deployment-safety workflow both real Linux/MySQL jobs successful.
- [ ] Admin enables main-target protected ruleset and all five universally available check contexts pinned to GitHub Actions App `15368`, with independent PR review and no force-push/delete/bypass. Issue #62.
- [ ] Independent security reviewer approves source PRs #59 and #60 and draft integration PR #61.
- [ ] After authorized merge: protected main fresh CI, authentic publisher signing/approval, hosted GitHub Release checks, live Hostinger and physical Windows installer acceptance.

**No signed production MSI, public release or Hostinger deployment is authorized by this document.**
