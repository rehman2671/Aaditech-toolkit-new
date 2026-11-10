# Release Readiness Assessment & Verification Gates

**Verdict:** **NOT PRODUCTION READY (RELEASE GATES PENDING)**  
**Measured Release Score:** **UNVERIFIED — previous score not a release gate**  
**Reviewed:** 2026-11-11 (Phase H branch; verified Docker smoke, full CI pending)  

---

## 1. Release Gate Criteria Matrix

| Gate # | Category | Criterion | Status | Empirical Evidence |
|---|---|---|---|---|
| **Gate 1** | Security | Zero committed secrets & private keys in git repo | **BLOCKED** | `certs/ca.key` present in repo history; requires external secret manager and Git history scrub |
| **Gate 2** | Security | Single-use bootstrap token gating & replay protection | **BLOCKED** | Verified via `test-auth-integration.js` & `test-device-auth-deep.js` |
| **Gate 3** | Security | Multi-tenant isolation verified | **BLOCKED** | Tenant UUID scoped composite indexes and queries verified |
| **Gate 4** | CI/CD | All CI jobs pass reliably | **BLOCKED** | 165+ Vitest tests and API suite passed in earlier PR runs; current PR HEAD requires complete passing CI including PowerShell index freshness |
| **Gate 5** | Database | Durable persistence with zero fake fallback successes | **BLOCKED** | MySQL 8 Range Partitioning verified; migrations 001-003 idempotent |
| **Gate 6** | Endpoint | Canonical Windows agent architecture selected | **PASS** | ADR-004: `Agent-Collect.ps1` with modular collectors & least privilege execution |
| **Gate 7** | Packaging | Authentic Windows MSI installer built & signed | **BLOCKED** | Real 64-bit MSI EXE compiled and install/uninstall tested on Windows CI (42908567117), but still unsigned; tracked 1,536-byte fixtures are not release binaries |
| **Gate 8** | Operations | Zero-downtime secret rotation & backup documented | **PASS** | Documented in `docs/operations/` |

---

## 2. Mandatory Release Gate Blockers

1. **Gate 1 (Committed CA Key):** Rotate CA certificate and remove `certs/ca.key` from git tree.
2. **Gate 7 (Production MSI Installer):** Trigger GitHub Actions `agent-build` on `windows-latest` runner to compile genuine WiX MSI and sign with internal CA.


## Phase H first-run setup (November 10, 2026)

Implementation staged on feat/phase-h-first-run-setup-20261110-2; code review, CI, clean Windows/MySQL deployment and real installer validation are required before merging or claiming production readiness. GitHub Actions run 42441689794 on main failed; the MSI artifacts remain 1536-byte fixtures. This branch does not resolve all security and installer release gates.

## Verified Phase H deployment evidence (November 11, 2026)

- **PASS (limited scope):** [GitHub Actions run 42899485261](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/42899485261) built and started the real Linux API + MySQL Docker Compose stack from clean volumes.
- Tests verified first-run host-local authorization, weak-password rejection, initial SUPER_ADMIN credentials, blocked default accounts, admin-only GET/PATCH system configuration, durable settings after container restart, and fail-closed SMTP test endpoint.
- **NOT VERIFIED:** Native Windows agent build/MSI install/repair/uninstall, Windows Docker Desktop, production HTTPS/mTLS, fleet command signature verification, cross-tenant security, full CI at the final PR head, upgrade/backup recovery, and integration endpoints that report NOT_IMPLEMENTED.
- **Do not merge/ship as production** until the remaining release gates are proven and separately reviewed.


## Phase I — Real Windows MSI and agent command trust (November 11, 2026)

**New verified Windows evidence:** [Windows GitHub Actions run 42908567117](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/42908567117) **SUCCESS** after building a genuine WiX x64 MSI and real PS2EXE agent. The installer lifecycle test validated Windows Installer metadata/CFB signature, installed the executable and scheduled task, then uninstalled and confirmed cleanup. An earlier run logged a **1,478,656-byte unsigned** MSI and a 67,584-byte EXE (both substantially larger than synthetic 1,536-byte fixtures).

**Agent trust implementation on Phase I PR #2:** command signing derives distinct device-scoped keys; commands bind ID, hostname, device ID, payload and expiry, with strict endpoint HMAC verification. HTTPS POST enrollment and no-global-master-token production authentication implemented. A credential-free MSI is staged in UNENROLLED mode; an administrator must provision enrollment after installation.

**Verified automated security tests:** 175/175 Node/Vitest tests and >71% statement coverage on a Phase I CI run, including tampered/expired/cross-device signature cases; four Pester signed-command tests passed on Windows PowerShell. Full Windows CI on the FINAL head must still be successful.

**Gate 7 remains BLOCKED:** unsigned CI MSI is NOT a release-signed binary. Signed Authenticode releases, real Windows 10/11 VM lifecycle (upgrade/repair/rollback), TLS/mTLS and enrollment integration, tenant scoping, and elevated-task file ACL security review remain required. No binaries published.

**Gates 1–5 and 8 require independent verification.** Phase I does not resolve previous persistent backend security/tenancy issues. Never release the current agent to production endpoints.
