# M1/M2 — Intranet server installer implementation backlog

**Status:** DESIGN BACKLOG, **NO installer changes implemented** in documentation PR.  
**Tracking issue:** [#80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80)  
**Architecture decision:** [DEC-001 issue #79](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79) **unapproved**; detailed runtime-specific changes require owner ADR.  
**Scope:** independent local office server deployment, local PKI, browser first-run, installation identity and offline acceptance.

## Verified deployment boundary

- Active `Enterprise/deploy/deploy-mysql.sh` and `Enterprise/deploy/Caddyfile` implement **Node/MySQL Docker on public DNS/ACME**. Their public-domain rejection and trust assumptions cannot be weakened to fake LAN support.
- The **older, not active** `Enterprise/deploy/Caddyfile.template` mentions an unauthenticated HTTP first-run path and a legacy `:9443` mTLS client-cert listener. Active `Caddyfile` specifically records that the Node enrollment server does not issue client certificates. Neither legacy feature is an implemented, safe current intranet trust profile.
- `Enterprise/agent/SETUP-WINDOWS.md` describes a generic Windows MSI and post-install GUI; it does **not** establish a complete office server installer.
- Multi-OS endpoint and signed per-tenant MSI factory scope from the original requirements must be preserved even if initial office rollout is intentionally phased (owner DEC-002/003).

## Implementation slices — work only after design approval

| ID | Depends on | Deliverable | Explicit non-destructive exit test |
|---|---|---|---|
| LAN-01 | DEC-001 and OS support decision | Supported host matrix, runtime topology, offline package/bundle manifest, pinned signed dependencies | Fresh target with WAN blocked passes preflight, or prints exact missing packages before changes |
| LAN-02 | LAN-01 | Installer dry-run with disk/CPU/ports/admin, existing app/DB/secrets, host identity, local DNS checks | Repeat dry-run produces no credential/filesystem/DB mutation |
| LAN-03 | LAN-02 | Internal HTTPS mode separated from current public-ACME mode; operator-supplied enterprise CA or authenticated local CA enrollment, correct FQDN/IP SAN | Valid chain and SAN accepted, expired/unknown cert rejected; never `SkipCertificateCheck`/HTTP credential wizard |
| LAN-04 | LAN-02/03 | Locally protected database + API secrets and serialized, idempotent migrations | Existing database+lost credentials fails closed; power loss/partial migration preserves records and supports recovery |
| LAN-05 | LAN-04 | Persistent installation UUID distinct from tenant/device/user; local backup/export and restore-as-same vs clone-as-new process | Office A/B collision tests and clone-secrets rejection pass |
| LAN-06 | LAN-03/05 | Guided server install → healthy API → first-run browser admin/org/workspace/setup → reconfigure settings | Browser wizard never receives DB root credentials; restart does not repeat bootstrap |
| LAN-07 | LAN-03/06 | Local signed agent enrollment with trusted endpoint and tenant-scoped short-lived bootstrap | 2 real Windows clients enroll with WAN disconnected; invalid tenant/cert/token denied |
| LAN-08 | LAN-04/05/07 | Backup, upgrade, rollback and repair/reconfigure path with independent encrypted backup | Offsite/air-gap restore and recoverability signed by operator/DBA |
| LAN-09 | LAN-01..08 | Real office acceptance evidence and operator handoff | `AT-LAN-01..07`, `AT-SEC-01..04`, `AT-OPS-01..03` recorded independently; CI-only success insufficient |

## Setup state machine (target, not existing code)

`NOT_INSTALLED → PREFLIGHT_OK → TRUST_BOOTSTRAPPED → DB_READY → API_READY → INITIAL_ADMIN_SETUP → AGENT_READY → ACCEPTED`

On failure, record machine-readable diagnostics and a safe retry state. A failed migration must not silently reinitialize a volume. An administrator may rerun setup to change LAN hostname and certificate trust **without** silently re-enrolling or duplicating device identities. Subsequent wizard access requires authenticated administrator privileges.

**Installation ID** must survive same-installation restore, and fork/clone must be explicitly treated as a *new installation* with fresh identity and appropriately revoked/rotated credentials. Backend database schema migration design remains dependent on DEC-001.

## Disconnected-LAN test matrix (minimum)

- Offline fresh install with internal CA and valid SAN, including Chrome/Edge trust of local cert through approved distribution.
- Same host with changed hostname/IP, invalid SAN, untrusted CA and expired cert; fail safely without downgrading to HTTP.
- Two independent offices with overlapping tenant names/device hostnames; reject installation/tenant/device cross-access.
- New install vs existing installation, broken DB credentials, occupied port, out-of-disk condition, partial migration and wrong backup identity.
- Two physical Windows 10/11 agents over private LAN; actual telemetry and signed command receipt, interrupted LAN, delayed ACK, duplicate retry and after-recovery delivery.
- Full backup/restore, upgrade and rollback; no unexpected API access to `tool.aaditechs.in` with WAN disconnected.
- Console/installer log scan for passwords, tokens, private keys, personal records; validate OS ownership/permissions on generated files.

## Reviewer boundaries

The public-DNS/VPS deployment continues to exist unchanged until a separate reviewed implementation supports internal TLS. Do not replace a secure public-host check with a permissive `--host 192.168.*` bypass. Do not claim Windows service/macOS/Linux parity, true mTLS, actual signed release or field acceptance merely because the installer design is written.

**Outcome:** `M1/M2 NOT_STARTED/PARTIAL` and **P0 gated** until approved architecture, implementation PRs and witnessed offline acceptance. See [installer contract](INSTALLER-AND-SETUP-ACCEPTANCE.md) and [acceptance matrix](ACCEPTANCE-TEST-MATRIX.md).
