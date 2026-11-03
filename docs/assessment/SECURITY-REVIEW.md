# Enterprise Security Review & Audit Findings

**Evaluation Standard:** OWASP ASVS 4.0 & CIS Endpoint Benchmark  
**Review Date:** 2026-11-03  

---

## 1. Secrets Management & Exposure Control

### Findings
- **Root `.env` and `certs/ca.key`:**
  - An RSA private key (`certs/ca.key`) and root `.env` were present in the local workspace.
  - Mitigations implemented:
    1. Updated `/.gitignore` with `certs/*.key`, `certs/*.pfx`, `certs/*.pem`, `.env`, and local override patterns.
    2. Created `/.dockerignore` preventing local secret inclusion during `docker build`.
    3. Documented zero-downtime certificate and secret rotation procedure in `docs/operations/SECRET-ROTATION.md`.

---

## 2. Authentication, Authorization & RBAC

| Security Layer | Implemented Control | Verified Outcome |
|---|---|---|
| **User Authentication** | bcrypt password hashing (cost factor 10+) | Plaintext passwords never stored; timing-safe checks |
| **Session Control** | JWT HS256 with cryptographically generated JTI | Session invalidation and revocation list (`/api/v1/auth/logout`) PASS |
| **Role-Based Access** | Strict gates: `SUPER_ADMIN`, `OPERATOR`, `MONITORING` | `MONITORING` users denied command dispatch (403); `OPERATOR` denied user creation (403) |
| **Device Enrollment** | Single-use bootstrap tokens (`used_bootstrap_tokens`) | Replay attacks blocked; tokens invalidated on consumption |
| **Device Identity** | Per-device SHA-256 token hashing (`device_token_hash`) | Devices authenticate with unique tokens or HMAC signatures |
| **Remote Commands** | HMAC-SHA256 payload signing with timestamp drift window | Commands expired after 10m; unauthorized executions blocked |

---

## 3. Defense Against Unsafe Remote Execution

- Remote commands are constrained to an approved action allowlist (`RUN_SCRIPT_ALLOWLIST`).
- Arbitrary unconstrained `Invoke-Expression` execution is blocked.
- Commands progress through an atomic state machine: `PENDING` -> `CLAIMED` -> `RUNNING` -> `COMPLETED` / `FAILED`.
