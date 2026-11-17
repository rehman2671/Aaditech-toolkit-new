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

---

## Verified Stage 17 and Stage 18 main CI ledger — 2026-11-17

| Stage | PR verification | Main CI | Main deployment-safety | Accepted scope |
|---|---|---|---|---|
| N17 | PR #7, CI #43980985118 and safety #43980984905 SUCCESS | [#43981328283](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43981328283) **SUCCESS 4/4** | [#43981328387](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43981328387) **SUCCESS 2/2** | MySQL tenant remediation migrations/outbox, transactional alert enqueue, retry/dead-letter worker, pinned HTTPS webhook; Node/Vitest, PowerShell, real MySQL/API, diagnostic Windows EXE/MSI |
| N18 | PR #8, CI #43981861732 and safety #43981861681 SUCCESS | [#43982225279](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43982225279) **SUCCESS 4/4** | [#43982225214](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43982225214) **SUCCESS 2/2** | Tenant-scoped audit, device processes/usage, groups/policies, patch approvals; Node/Vitest, PowerShell, real MySQL/API and Windows diagnostic MSI installation/upgrade |

These tests execute on CI runners and disposable databases. They do **not** prove real Hostinger TLS/recovery, an independent signed public MSI, recipient inbox delivery, actual production secrets, or physical customer Windows install/UAC. **Do not certify production** without those external proofs.

---

## 6. Verified Phase N Stage 19 and Stage 20 (2026-11-17)

- Stage 19 [PR CI #43988626978](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988626978) SUCCESS and [PR safety #43988626942](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988626942) SUCCESS.
- Stage 19 [main CI #43988981985](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988981985) SUCCESS **4/4**: Node/Vitest, PowerShell, real MySQL/API, diagnostic Windows EXE/MSI extraction and install/uninstall/upgrade. [Main safety #43988982034](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43988982034) SUCCESS **2/2**.
- Stage 20 [PR CI #43989416002](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43989416002) SUCCESS and [PR safety #43989416187](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43989416187) SUCCESS.
- Stage 20 [main CI #43989734105](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43989734105) SUCCESS **4/4**: Node/Vitest, PowerShell, isolated real MySQL/API migration and fault injection, Windows EXE/MSI install/uninstall and upgrade rehearsal. [Main safety #43989734122](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43989734122) SUCCESS **2/2**.
- Verified code regressions: platform-only release-control gating, fixed trusted CI destination, server-only GitHub PAT, credentials scrub SQL 007, synthetic command dispatch rejection, agent-tenant audit, SQL 008 ticket key scrub and redaction, local-only ticket truthfulness, cloud no-false-connect and selected-tenant device remediation.

**Not covered by these automated proofs:** signed public installer, physical managed Windows UAC/upgrade, live Hostinger VPS/domain/TLS, authorized real production DB restore, actual SMTP inbox receipt or live Jira/Graph provider response. These remain **BLOCKED / NOT_CONNECTED** as appropriate.

---

## 7. Verified Phase N Stage 21 and Stage 22 (2026-11-17)

- Stage21 [PR CI #44042019746](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44042019746) SUCCESS; [PR safety #44042019707](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44042019707) SUCCESS; merged `908ff54ee7fbef94d523e51b44ebcca27736e2d2`.
- Stage21 [main CI #44042340512](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44042340512) **4/4 SUCCESS** including Node/Vitest, PowerShell, real MySQL/API, Windows EXE/MSI install/uninstall/upgrade. [Main safety #44042340598](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44042340598) **2/2 SUCCESS**.
- Stage22 [PR CI #44043152228](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043152228) SUCCESS; [PR safety #44043152314](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043152314) SUCCESS; merged `af72dabe41818b8403f8a97f714b41606e1a9880`.
- Stage22 [main CI #44043497516](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043497516) **4/4 SUCCESS** including Node/Vitest, PowerShell, isolated MySQL/API fault injection, Windows EXE/MSI install/uninstall/major-upgrade. [Main safety #44043497509](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043497509) **2/2 SUCCESS**.
- Regression focus: HMAC-SHA256 destination pinning, changed recipient/URL quarantine, NULL-owned old jobs fail closed, lease expiry/ack consistency, migration 009; direct event tenant/device SQL ownership, quarantine legacy NULL events, no hostname JOIN or shared Redis hostname usage, migration 010.
- **External not yet accepted:** real signed MSI publisher identity, physical customer Windows, actual Hostinger domain/TLS/VPS, customer DB migration/offsite restore, live SMTP inbox + webhook receiver and third-party Jira/Graph APIs. Do not label production certified.

---

## 8. Verified Stage 23 — SQL-authoritative remote command lifecycle (2026-11-17)

- [PR CI #44053797392](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44053797392) **SUCCESS**; [PR deployment safety #44053797380](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44053797380) **SUCCESS**. PR #13 squash-merged as `c53fc58fa276895bb391e21d648470954ee2e03f`.
- [Main CI #44054232799](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232799) **4/4 SUCCESS**, including Node/Vitest and HTTP tests, PowerShell validation, real MySQL 8/API network fault injection, diagnostic Windows MSI install/uninstall/major-upgrade.
- [Main safety #44054232802](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232802) **2/2 SUCCESS**, isolated MySQL backup/restore and offline safety controls.
- Regression coverage: MySQL write errors never report queued, command ID reads/pending reads fail closed on production DB, concurrent pollers claim with device-bound CAS, result database update requires `IN_PROGRESS` and exact device ID, duplicate/pre-poll results HTTP 409, invalid output/status bodies rejected, remediation queue failure returns 503.
- **Production external gates remain blocked:** physical customer Windows agent UAC/upgrade, public Authenticode signed installer, Hostinger DNS/TLS/VPS, approved offsite customer DB restore, real SMTP receiver/webhook, Microsoft Graph and Jira provider verification.

---

## 9. Phase N Stage 24 verified posture provenance (2026-11-17)

- [PR CI #44064858994](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44064858994) **SUCCESS**; [PR safety #44064859054](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44064859054) **SUCCESS**; squash merge commit `eaa2a7b8e6665542e2ad6b6bb3e6e3cc2c0a817a`.
- [Main CI #44065258102](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258102) **SUCCESS 4/4**: Node/Vitest, PowerShell, real isolated MySQL/API and network fault injection, Windows diagnostic WiX MSI installation, uninstall and major-upgrade preservation.
- [Main deployment safety #44065258073](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258073) **SUCCESS 2/2**, including disposable MySQL8 backup/restore and Bash recovery checks.
- New tests verify that absent/legacy/stale posture does not produce compliance, known real reported fields remain distinguishable, zero scores preserve numeric 0, partial reports are non-attested and validation rejects invalid status shapes and score ranges. Enrollment SQL defaults are neutral, migration 011 is checked, and agent code no longer presumes protected/active on failed collectors.
- **Not independently validated:** real physical customer Windows estate, signed public installer, live Hostinger, customer DB offsite restore, delivered mailbox/webhook receipt, OAuth Graph/Jira service calls. Test results above are diagnostic CI only.
