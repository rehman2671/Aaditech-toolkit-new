# Repository Audit & Deep Architecture Assessment

**Audit Execution Date:** 2026-11-03  
**Auditor:** Principal Software Architect & Lead Systems Engineer  
**Repository:** `Aaditech-toolkit-new`  
**Authoritative Runtime:** Node.js v20+ / Express 4.x, MariaDB / MySQL 8.0, Redis Cache, Windows PowerShell Endpoint Agent  

---

## 1. Repository Inventory & Discovery Proofs

| Metric | Measured Value | Verification Method |
|---|---|---|
| Total Tracked Files | **212** | `audit/scanner.cjs` filesystem walk |
| Total Directories | **63** | Recursive directory indexing |
| JavaScript Files | **27** | Express backend, migrations, test suites |
| TypeScript Files | **0** | Pure ESM JavaScript with Zod validation |
| Test Suites | **30** | Vitest unit/integration + standalone suites |
| Documentation Files | **53+** | Markdown specs, ADRs, compliance docs |
| Total Lines of Code | **71,622** | Measured UTF-8 LOC |

---

## 2. Core Architecture Topology

```
+-----------------------------------------------------------------------+
|                   Enterprise Management Web Portal                    |
|       (Public SPA, Lucide Icons, Chart.js, Tailwind CDN, React)       |
+-----------------------------------------------------------------------+
                                   |  HTTPS / TLS 1.3
                                   v
+-----------------------------------------------------------------------+
|                    API Gateway & Application Server                   |
|           (/server.js - Express 4.x, Port 3000 / Reverse Proxy)       |
|    - OpenAPI 3.0 Contract: 82 endpoints (/api/v1/*, /api/*)           |
|    - RBAC: SUPER_ADMIN, OPERATOR, MONITORING (bcrypt + JWT)           |
|    - Security Gates: Replay defense, HMAC signatures, Rate limits     |
+-----------------------------------------------------------------------+
                  |                                     |
                  v                                     v
+----------------------------------+   +--------------------------------+
|       MySQL 8.0 / MariaDB        |   |       Redis Cache & Queue      |
|  - 15 Core Tables + Partitions   |   |  - O(1) Session & Telemetry    |
|  - Range Partitioning (TO_DAYS)  |   |  - Cluster State Sharing       |
|  - Migration Runner (001-003)    |   |  - Rate Limit Buckets          |
+----------------------------------+   +--------------------------------+
                  ^
                  | HTTPS / mTLS (:9443 optional)
+-----------------------------------------------------------------------+
|                    Windows Endpoint Agent                             |
|       (IT-Toolkit-Agent.exe - compiled from Agent-Collect.ps1)        |
|  - Least Privilege Worker (NETWORK SERVICE)                           |
|  - Elevated Action Handoff (schtasks SYSTEM ITToolkitAgentElevated)   |
|  - Offline Queue (SQLite3) + Exponential Backoff & Jitter             |
|  - Hardware Telemetry & Real Process Scraper (Zero Mock Data)         |
+-----------------------------------------------------------------------+
```

---

## 3. Discovered Inconsistencies & Remediation Summary

1. **PowerShell Parser Syntax Error (CI-01):**
   - *Root Cause:* `Enterprise/agent/Aaditech-Agent.ps1` line 129 used `path = try { $_.Path } catch { "System" }` directly inside a hashtable literal expression.
   - *Fix:* Extracted `$procPath` assignment prior to hashtable construction.
2. **CI Test Ordering Defect (CI-02):**
   - *Root Cause:* `.github/workflows/ci.yml` invoked `test-auth-integration.js` before launching the background server on port 3000, causing connection refusal (`ECONNREFUSED`).
   - *Fix:* Reordered steps to start background server with dynamic healthz readiness probe (up to 30s) before executing dependent integration test suites.
3. **Committed Secrets & Missing Ignore Rules (P0-01):**
   - *Root Cause:* `certs/ca.key` was present in source tree; root `.env` and `certs/*.key` were omitted from `.gitignore`; `.dockerignore` did not exist.
   - *Fix:* Added `.gitignore` exclusions for `.env`, `certs/*.key`, and created production `.dockerignore`.
4. **Dual Agent Implementation (AGENT-01):**
   - *Root Cause:* Coexistence of `Agent-Collect.ps1` and `Aaditech-Agent.ps1`.
   - *Fix:* Formulated ADR selecting `Agent-Collect.ps1` as canonical production agent with `Aaditech-Agent.ps1` as operator utility.
