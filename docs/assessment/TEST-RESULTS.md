# Empirical Test Results & Verification Ledger

**Execution Timestamp:** 2026-11-03  
**Runner:** Node.js v20+ Test Environment  

---

## 1. Test Suite Execution Summary

| Test Suite File | Type | Total Checks | Passed | Failed | Status |
|---|---|---|---|---|---|
| `scripts/check-version-consistency.cjs` | Version Drift | 1 | 1 | 0 | **PASS** |
| `vitest run --coverage` | Unit & Integration | 152 | 152 | 0 | **PASS** |
| `test-contract-validation.js` | OpenAPI 3.0 Contract | 82 | 82 | 0 | **PASS** |
| `test-auth-integration.js` | Auth & RBAC Integration | 21 | 21 | 0 | **PASS** |
| `test-migrations-runner.js` | MySQL Migrations & Partitioning | 7 | 7 | 0 | **PASS** |
| `test-msi-packaging-integration.js` | MSI Packaging & Artifacts | 8 | 8 | 0 | **PASS** |
| `test-id-generation-race.js` | Concurrency & Race Defense | 50 | 50 | 0 | **PASS** |
| `test-query-performance-indexing.js` | SQL EXPLAIN & O(1) Cache | 25 | 25 | 0 | **PASS** |
| `test-device-auth-deep.js` | Device Security & Enrollment | 45 | 45 | 0 | **PASS** |

**Grand Total:** 391 Checks Executed — **391 Passed, 0 Failed (100% Success Rate)**

---

## 2. Test Coverage Metrics (V8 Engine)

- **Statements:** 73.09% (Threshold: 70%)
- **Lines:** 78.11% (Threshold: 70%)
- **Functions:** 84.33% (Threshold: 70%)
- **Branches:** 61.73%

---

## 3. Verified Phase N Stage 15 CI (2026-11-17)

These runs are **new evidence**, not included in the historical November 3 check totals above:

- [PR CI #43970144713](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43970144713): SUCCESS, Node/Vitest, PowerShell, real MySQL/API (MSI build intentionally skipped for PR).
- [Main CI #43970542356](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43970542356): SUCCESS across 4/4 jobs. Includes real isolated MySQL/API verification, DB fault injection, PowerShell validation and Windows diagnostic MSI install, uninstall and upgrade rehearsals.
- [Main deployment-safety #43970542652](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43970542652): SUCCESS across 2/2 jobs; offline deployment checks plus disposable MySQL backup/restore integrity.

**These results do not certify production release signing, public MSI publication, Hostinger deployment, real production data restore or a physical customer-machine Windows install.**

---

## 4. Verified Phase N Stage 16 CI (2026-11-17)

- [PR CI #43975986561](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43975986561) completed SUCCESS: Node/Vitest, PowerShell and real MySQL/API integration. Windows MSI job intentionally skipped for PR.
- [Main CI #43976367121](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43976367121) completed SUCCESS **4/4**: Node/Vitest, PowerShell, real disposable MySQL/API (including network/DB fault injection), Windows EXE/MSI build, administrative payload extraction, install/uninstall and major-upgrade preservation rehearsals.
- [Main deployment-safety #43976367102](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43976367102) completed SUCCESS **2/2**: offline safety and isolated MySQL backup/restore tests.
- The Stage 16 regression covers tenant-scoped inventory reports and remediation ownership, SMTP fail-closed encryption/config/recipient domain validation, separate tenant email consent, and rejection of false test-email delivery claims.

**CI does not verify:** public code signing, actual Hostinger deployment, genuine SMTP relay/certificate/recipient inbox acceptance, physical customer Windows machines or recovery of real production data. Do not infer those outcomes from green automated checks.
