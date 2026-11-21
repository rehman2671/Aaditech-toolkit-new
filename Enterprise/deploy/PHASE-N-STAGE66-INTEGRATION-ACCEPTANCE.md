# Phase N Stage 66 — N64 + N65 combined security gate rehearsal

**Status: INTEGRATION CANDIDATE; HUMAN SECURITY REVIEW AND PROTECTED MAIN MSI VALIDATION PENDING (2026-11-21 IST).**

## Reason for separate preview

[PR #59](https://github.com/rehman2671/Aaditech-toolkit-new/pull/59) and
[PR #60](https://github.com/rehman2671/Aaditech-toolkit-new/pull/60)
individually passed Windows/Node/MySQL and deployment safety checks but both
modify `.github/workflows/ci.yml`. Checking the two independently does not
prove that conflict resolution preserves both security controls.

## Integrated change set

- This candidate is an explicit two-parent test merge of N65 head
  `f1f022bdab415ca0f3e6309e710c9dcf6ed629ff` and N64 head
  `556cd27cf883378bba8ec95388c3493a820e98aa`.
- Resolve the only shared file (`.github/workflows/ci.yml`) by retaining
  **both** Windows PowerShell 7/5.1 N64 compiler-payload tests **and** N65
  immutable SHA action references.
- Preserve all other N64 protected-compiler checks, acceptance documents,
  and N65 YAML-aware action allowlist controls unchanged.
- Add `scripts/check-phase-n64-n65-integration.cjs` and Node regressions
  so accidental loss of a Windows N64 payload test, Windows PowerShell 5.1
  execution, protected MSI signing steps or reviewed dispatch environment
  fails the normal `npm run lint` CI gate.

## Verification and release block

- [ ] Combined PR Windows PowerShell validation and Node/Vitest/MySQL CI green.
- [ ] Combined PR deployment safety recovery and real MySQL restore green.
- [ ] Independent security reviewer validates conflict resolution and
  confirms original PR #59/#60 change ownership before authorized merge.
- [ ] Review-approved `main` rebuilds actual Windows MSI and exercises
  fresh install, GUI setup, uninstall, configuration-preserving upgrade.
- [ ] Genuine N63 package hash approvals, N56 reviewer certificate and
  signature, publisher signing, protected GitHub publication, Hostinger
  endpoint and physical customer Windows acceptance completed.

**This preview must not be merged directly to main without human review.
No customer production approval or signed installer is implied.**
