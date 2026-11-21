# Phase N Stage 67 — main-only release build and executable signing gates

**Status: CODE PUSHED FOR INTEGRATION REVIEW; CI AND HUMAN REVIEW PENDING; CUSTOMER PRODUCTION NOT APPROVED.**

## Finding

N66's gate check used protected step *names*, rather than the actual
commands and security expressions. Also, the Windows `agent-build` job
selected the `production-installer` review environment for manual dispatch
even from branches other than main; inner N63 steps had a main condition,
but the job-level gate did not.

## Implementation

- Explicitly restrict the Windows `agent-build` job to `main` for both
  diagnostic pushes and manual dispatches. Only main manual builds can
  reach the reviewer-protected signing environment.
- Add `scripts/check-phase-n67-release-workflow.cjs` to structurally
  verify workflow job conditions, reviewer environment, N63 approved
  compiler package scripts, staged EXE/MSI signing, publisher secret
  gating, receipt verification, reviewed artifact upload, real Windows
  MSI install and upgrade rehearsals.
- Verify the separate protected publishing workflow still downloads the
  approved source run, checks out exact SHA without persistent
  credentials, validates reviewer approval and signer identity, stages
  a private draft, attests remote assets before publication, rechecks
  reviewer and signed MSI, and attests hosted assets afterward.
- Include negative tests for switched branches, downgraded environments,
  removed API dependency, altered package install, signing/receipt no-ops,
  and bypassed private draft checks in `npm run lint`.

## Acceptance gates

- [ ] Combined Windows/Node/MySQL CI and database recovery suite green.
- [ ] Independent N64–N67 reviewer approval and authorized integration
  sequence; draft PR not merged directly.
- [ ] Fresh `main` diagnostic Windows MSI and upgrade acceptance.
- [ ] Real N63 package SHA approvals, N56 signed reviewer release consent,
  valid publisher certificate, private-hosted asset checks, Hostinger
  environment and physical enrolled customer Windows acceptance.

**No signing secrets generated, production publish triggered, or approval
claimed.**
