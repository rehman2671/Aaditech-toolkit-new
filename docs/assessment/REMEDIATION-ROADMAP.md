# Master Remediation Roadmap & Execution Schedule

---

## Phase 0 — Critical Security Remediation (COMPLETED)
- [x] Fix `.gitignore` to prevent secret leaks (`.env`, `certs/*.key`).
- [x] Create root `.dockerignore` for container build isolation.
- [x] Enforce strict zero-fallback secrets validation at application boot (`JWT_SECRET`, `BOOTSTRAP_SECRET`, `COMMAND_SIGNING_KEY`, `HMAC_SECRET`, `API_TOKEN`).
- [x] Enforce single-use bootstrap tokens with hash indexing in MySQL.
- [x] Enforce HMAC-SHA256 command signing with replay and timestamp validation.

## Phase 1 — CI & Agent Integration (COMPLETED)
- [x] Remediate PowerShell AST parser syntax in `Enterprise/agent/Aaditech-Agent.ps1`.
- [x] Fix CI pipeline ordering in `.github/workflows/ci.yml` (API background startup with healthz polling probe before integration suites).
- [x] Establish Canonical Agent Protocol ADR (CAP-v1 selecting `Agent-Collect.ps1` with least privilege execution).
- [x] Verify API Contract (100% of 82 OpenAPI 3.0 operations implemented in `server.js`).

## Phase 2 — Database Durability & Distributed Architecture (COMPLETED)
- [x] Standardize migrations on MySQL 8.0 native range partitioning (`TO_DAYS(recorded_at)`).
- [x] Implement atomic command state machine (`PENDING` -> `CLAIMED` -> `RUNNING` -> `COMPLETED`/`FAILED`).
- [x] Redis caching layer for hot-path device queries and rate-limiting.

## Phase 3 — Real Enterprise Functionality (COMPLETED)
- [x] Telemetry ingestion reading real CPU, RAM, disk, processes, BitLocker, and Antivirus status.
- [x] Predictive analytics using linear trend regression on empirical historical telemetry (flagging `INSUFFICIENT_DATA` when samples < 5).
- [x] Webhook testing actually executing external delivery.
- [x] Cloud integrations displaying `NOT_CONFIGURED` rather than fake health indicators.

## Phase 4 — Production Release Gates (PENDING GATES)
- [ ] Rotate committed CA certificate and private key.
- [ ] Trigger WiX 5.x Windows runner build to replace 1,536-byte mock fixture with authentic signed installer.
- [ ] Execute clean-room Windows end-to-end acceptance run:
  `INSTALL -> ENROLL -> HEARTBEAT -> COLLECT -> UPLOAD -> POLL -> EXECUTE -> ACKNOWLEDGE -> UNINSTALL`.
