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
| **Gate 7** | Packaging | Authentic Windows MSI installer built & signed | **BLOCKED** | Tracked MSI is a 1,536-byte mock fixture; requires WiX 5.x build on Windows runner |
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
