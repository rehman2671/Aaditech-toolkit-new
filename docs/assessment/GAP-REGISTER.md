# Prioritized Gap Register

**Authoritative Status as of:** 2026-11-03  
**Status Lifecycle:** `RESOLVED_VERIFIED` | `OPEN_GATE` | `IN_PROGRESS` | `DEFERRED_PREREQUISITE`  

---

| Issue ID | Priority | Severity | Component | Problem Description & Root Cause | Affected Files | Status | Verification Evidence |
|---|---|---|---|---|---|---|---|
| **CI-01** | P0 | CRITICAL | PowerShell Agent | Invalid `try/catch` expression inside hashtable literal causing AST parse failures. | `Enterprise/agent/Aaditech-Agent.ps1` | `RESOLVED_VERIFIED` | Clean AST parse; `npm run test:all` PASS |
| **CI-02** | P0 | CRITICAL | CI Pipeline | `test-auth-integration.js` executed prior to background API server start (`ECONNREFUSED 127.0.0.1:3000`). | `.github/workflows/ci.yml` | `RESOLVED_VERIFIED` | Reordered workflow; healthz readiness probe added |
| **P0-01** | P0 | CRITICAL | Security / Secrets | `certs/ca.key` present; root `.env` and `certs/*.key` not ignored; no `.dockerignore`. | `.gitignore`, `.dockerignore`, `certs/ca.key` | `RESOLVED_VERIFIED` | `.gitignore` updated; `.dockerignore` created; secret rotation procedure documented |
| **P0-02** | P0 | CRITICAL | Enrollment Security | Anonymous bootstrap token consumption and token recycling risks. | `server.js`, `db.js` | `RESOLVED_VERIFIED` | `test-auth-integration.js` & `test-device-auth-deep.js` PASS (100%) |
| **P0-03** | P0 | HIGH | Credential Scope | Global agent token separation from per-device tokens. | `server.js`, `db.js` | `RESOLVED_VERIFIED` | Device tokens hashed with SHA-256; HMAC signature verified |
| **P0-04** | P0 | CRITICAL | Tenant Isolation | Authoritative multi-tenant context required on device operations. | `server.js`, `database/mysql/schema.sql` | `RESOLVED_VERIFIED` | Tenant-scoped composite indexes; isolation tests pass |
| **P0-05** | P0 | HIGH | Remote Commands | Remote execution requires signing, timestamp validation, and allowlist enforcement. | `server.js`, `Enterprise/agent/` | `RESOLVED_VERIFIED` | HMAC-SHA256 command signing and state machine verified |
| **AGENT-01**| P1 | MEDIUM | Endpoint Agent | Divergence between `Agent-Collect.ps1` and `Aaditech-Agent.ps1`. | `Enterprise/agent/` | `RESOLVED_VERIFIED` | ADR-004 / CAP-v1 canonical agent protocol established |
| **PROD-01** | P1 | HIGH | Packaging | Tracked MSI artifact is 1,536-byte mock CFBF fixture; requires WiX build on Windows runner. | `artifacts/msi/IT-Toolkit-Agent-1.1.2.msi` | `OPEN_GATE` | WiX 5.x pipeline ready in CI; release gate blocks production mark |
