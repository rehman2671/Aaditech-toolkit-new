# Phase N Stage 66 — N64 + N65 combined security gate rehearsal

**Status: COMBINED CI + SAFETY PASSED; REAL PREMERGE N68 WINDOWS MSI PASSED; HUMAN REVIEW AND POST-MERGE MAIN VALIDATION PENDING (2026-11-21 IST).**

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

- [x] Combined PR Windows PowerShell validation and Node/Vitest/MySQL CI green: [N66 CI 44885892452](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44885892452) **3/3** and latest [N68 CI 44889704068](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44889704068) **4/4**, including unsigned real Windows MSI preview.
- [x] Combined PR deployment safety recovery and real MySQL restore green: [N66 safety 44885892567](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44885892567) and [N68 safety 44889703995](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44889703995), both **2/2**.
- [ ] Independent security reviewer validates conflict resolution and
  confirms original PR #59/#60 change ownership before authorized merge.
- [ ] Review-approved `main` rebuilds actual Windows MSI and exercises
  fresh install, GUI setup, uninstall, configuration-preserving upgrade.
- [ ] Genuine N63 package hash approvals, N56 reviewer certificate and
  signature, publisher signing, protected GitHub publication, Hostinger
  endpoint and physical customer Windows acceptance completed.

**This preview must not be merged directly to main without human review.
No customer production approval or signed installer is implied.**
