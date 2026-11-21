# Phase N Stage 68 — real premerge Windows MSI diagnostic acceptance

**Status: PR DIAGNOSTIC WINDOWS MSI BUILD / INSTALL / UPGRADE PASSED; CI 4/4, SAFETY 2/2; INDEPENDENT REVIEW/MAIN MERGE PENDING (2026-11-21 IST).**

## Existing gap

N64/N65/N66/N67 tests passed combined Node/MySQL and PowerShell validation,
but the actual EXE compilation, WiX MSI packaging, administrative extraction,
elevated install/uninstall and major-upgrade scripts were only run on `main`
pushes. The review branch had no real Windows Installer execution evidence.

## Implementation

- Add a separate `agent-diagnostic-pr` Windows job to `CI` for same-repository
  integration pull requests targeting `main`, only after Windows security,
  Node and MySQL/API upstream test gates succeed.
- Give the job only `contents: read`. Do NOT associate the
  `production-installer` environment, signing secrets, token write access,
  release publication, or downloadable MSI artifacts.
- Deny any observed production code-signing/reviewer credential before
  compiling. Pin PS2EXE `1.0.18` and WiX `5.0.2` for **diagnostic purposes
  only**; independently SHA-approved production packages remain mandatory.
- Produce authentic Windows EXE and MSI, explicitly set and verify
  `RELEASE_SIGNING_ENABLED=false`, assert both binaries are unsigned.
- Reuse the **same** generic unprovisioned config, MSI administrative
  extraction, actual Windows install/uninstall and configuration-preserving
  major-upgrade acceptance steps as the main MSI job.
- Add `scripts/check-phase-n68-pr-diagnostic-msi.cjs` and negative
  regressions to fail lint when CI weakens the PR restrictions, permits
  signing/upload, changes the compiler version, or drops Windows acceptance.

## Verified evidence

- [N68 CI 44889704068](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44889704068) **4/4 SUCCESS** on `076936727b4fb2ea17e49f5dfde1de31dafd759f`: Windows PowerShell 5.1/7 security, Node/Vitest + MySQL, API/MySQL, **actual unsigned EXE/MSI compilation**, administrative extraction, first-run GUI + blank setup, isolated elevated installation/clean uninstall, and tenant/device/SQLite state-preserving major upgrade.
- [N68 safety 44889703995](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44889703995) **2/2 SUCCESS** on the same commit, including real isolated MySQL backup/restore.
- **Zero** PR artifacts published. EXE/MSI verified **NotSigned**. Diagnostic MSI must never be distributed to customers. Initial N68 lint false-positive and N62 single-toolchain-count mismatch were corrected before this successful run.
- [Release governance blocker #62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62): `main` unprotected, zero active rulesets and no independent reviews on PR #59/#60/#61. Human-admin actions remain mandatory.

## Acceptance

- [x] PR diagnostic Windows job built EXE and MSI and passed administrative
  extraction (GUI + unprovisioned `agent.json`), real install/uninstall and
  major-upgrade preserving HTTPS server, tenant state, device identity,
  queue and SQLite ACK evidence on an isolated runner.
- [x] N68 Node/MySQL API CI and deployment safety checks green.
- [ ] Human security review of PRs #59–61 and authorized integration/merge.
- [ ] Fresh protected-main Windows diagnostic build and genuine
  signer-authorized release; Hostinger DNS/TLS and physical enrolled Windows
  endpoint acceptance.

**Unsigned preview is never suitable for customer installation or
distribution. Customer production remains NOT APPROVED.**
