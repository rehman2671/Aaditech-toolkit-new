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

## Offline supply-chain and Windows host reality — source-level gap

The existing `Enterprise/docker-compose.yml` uses **mutable** `mysql:8.0` and `caddy:2-alpine` image tags. `Dockerfile` uses mutable `node:20-alpine` and runs `npm ci --omit=dev || npm install --omit=dev`. The fallback means a failed lockfile install may use a different dependency resolution; an offline first-install may need network registry access. The public deployment's active `Enterprise/deploy/Caddyfile` still assumes DNS/ACME. **None is proof of a signed, reproducible, WAN-disconnected package.**

Future installer acceptance must:
1. Supply a reviewed, pinned **image-digest and npm-dependency manifest**, package provenance/signing, offline image archive import and hashes. Never fetch from Docker Hub/npm/public CA when the operator selected fully offline mode.
2. Ensure package/build reproducibility: build the signed release artifact in a controlled environment with strict lockfile enforcement, or a verified offline dependency cache; reject cache tampering, lockfile mismatch, unapproved image drift and missing artifacts *before* database or secret mutation.
3. Explicitly choose and test how supported **Windows Server host releases** run the service/runtime. A Linux-container Compose file does not by itself demonstrate native Windows Server compatibility. Document an approved VM/runtime model or supported alternative, elevation, lifecycle and backup behavior.
4. Make a reviewed intranet-only ingress profile with server-bound SAN, local CA/enterprise PKI and controlled firewall interfaces. Compose currently maps host 80/443 but does **not** publish MySQL/API host ports; preserve that containment and test unauthorized-network denial.
5. Test **WAN physically disconnected before the installer is run**, not only after a successful online installation. Include first-run install, upgrade, rollback and artifact cache checks.
6. Retain active public-DNS/ACME safeguards; never relax `deploy-mysql.sh` hostname validation simply to accept local IPs. Implement separate LAN mode with independent acceptance.

**P0 gate:** `AT-LAN-08` requires an immutable signed offline bundle and positive/negative host compatibility tests. These are target requirements, *not* implemented capabilities. Full source evidence and acceptance discussion: [issue #80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80).

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

## 2026-11-25 — Local resource collection and combined LAN readiness (#113)

Added `scripts/local-resource-diagnostic.mjs`, a local operator-only reference collector of actual OS CPU counter deltas, physical RAM usage and selected filesystem block utilization. It produces canonical resource artifact bytes and SHA-256; missing observations remain null. CPU is OS-reported (not necessarily container quota), RAM is total minus OS free memory (not application pressure), disk uses total minus free blocks (not unprivileged available capacity). Select a trusted local filesystem; no remote invocation, command dispatch, persistence, signing-key custody or repair. Added `scripts/lan-combined-preflight.mjs` composing independently pinned signed offline-bundle verification before actual read-only host inspection, snapshotting local policy before awaits. Existing markers, insufficient/unknown resources or observed/unknown listeners block; absent markers are not proof of absence. No network probe, port reservation, TLS/runtime proof, actual installation, activation or production authorization. Seven regression tests include actual local OS observations, synthetic signed review binding and signed payload plus host inspection. Fresh exact-head CI, independent review, owner ADRs and witnessed LAN/endpoint acceptance remain required.
