# Architecture decision — independent intranet installations (ADR-PRODUCT-001)

**Decision:** Intranet-first is the mandatory baseline; external cloud is optional.  
**State:** Target architecture approved as the product direction for planning; specific LAN installer, certificate/trust flow and independent installation ID are **not implemented/accepted yet**.

## Current repository facts versus proposed behavior

| Subsystem | Existing source | Current truth | Required change |
|---|---|---|---|
| Backend | `server.js`, `Dockerfile` | Node.js/Express | Keep and package for office host |
| Persistent data | `db.js`, `Enterprise/docker-compose.yml` | MySQL 8 with migrations | Support durable LAN deployment, backup and restore |
| UI | `Enterprise/portal/index.html` | First-run browser wizard and dashboard | Front-load machine/network/PKI provisioning through guided installer |
| Reverse proxy | `Enterprise/deploy/Caddyfile` | Caddy with public-host configuration | Add separate internal-host HTTPS profile |
| Windows endpoint | `Enterprise/agent/Agent-Collect.ps1`, WiX | MSI, local outbox and per-device HTTPS token flow | LAN trust/first-run and bulk-enrollment acceptance |
| Current deploy entrypoint | `Enterprise/deploy/deploy-mysql.sh` | Docker/Linux VPS with public DNS and ACME | Add reviewed intranet installer, not public-host bypass |
| Historical deployments | `Enterprise/deploy/deploy.sh` and `deploy.ps1` | Incompatible PostgreSQL/FastAPI flow intentionally fails | Replace/reconcile; **do not turn off safety guard** |
| Historic specs | `Documentation/PROJECT-SPEC.md`, `docs/architecture/Technical-Architecture-Spec.md` | FastAPI/PG or Go/PG conceptual designs | Retain history; this decision governs future product work |

## Trust topology

`Office A (independent)`
- One authorized local server or VM: web UI -> Node API -> MySQL, persistent storage, backup scheduler.
- Local LAN hostname/IP with certificate whose SAN matches the selected endpoint. TLS chain trusted by corporate Windows agents through domain GPO, MDM or reviewed manual onboarding; no `-SkipCertificateCheck` or automatic trust of arbitrary CA.
- One immutable `installation_id` (random UUID) created locally. One or more isolated `tenant_id` workspaces. Individually enrolled `device_uid` with installation+tenant binding and per-device credential.
- Server-side approvals/repair commands; Windows agent uses least privilege, allowlisted scripts, bounded queue, signed commands and tamper-evident receipts.

`Office B (independent)`
- Own independent server, DB, key material, identity and users. The identity from Office A cannot grant Office B access.
- No network path between offices is required. WAN outage affects only optional extras.

`tool.aaditechs.in (optional, FUTURE)`
- May host public marketing/support portal, permissioned license validation, approved manifests or opt-in installation registry.
- No sync, heartbeat or licensing request may be required to start/continue intranet core workflows when offline. Explicit organizational consent for any metadata sent outside LAN; minimum possible personal data.

## Security and data rules

1. Existing **HTTPS + enrolled device token** is the current Node agent transport. Historical mTLS text is **not** a claim that mTLS issuance actually works. Optional true client certificate enrollment needs a separate reviewed design.
2. Intranet HTTPS means **internal hostname + proper certificate trust**, not unencrypted HTTP or turning off TLS verification. The local installer must validate name, time, chain and revocation behavior in an isolated network.
3. Setup credentials, TLS keys, database root credentials and backup keys remain server/OS-owned; browser never gets root DB credentials.
4. Automatic installer chooses a *non-destructive* DB upgrade path. Existing volume plus missing secrets = fail closed; never advise `docker compose down -v` to "fix" installation.
5. Separate snapshot identity from physical instance identity: restore over same logical instance preserves `installation_id`; cloning to create a separate office requires **explicit new identity** plus token/tenant/device isolation and duplicate-detection. No silent restore-as-new.
6. Office connection defaults block outbound network use. Future cloud integrations require opt-in and independent configuration; no implicit central telemetry.
7. Local devices are discoverable via operator-selected LAN hostname/IP and optional approved DNS/DHCP tooling. No automatic active LAN scanning of unmanaged assets.
8. Logs and reports must show installation, tenant and device origin; no cross-office global dashboard without a separately consented federation design.

## Deployment profiles

| Profile | Priority | Requirements |
|---|---|---|
| `intranet` | P0 | Offline-bundled images/runtimes, Windows/Linux installer support matrix, local HTTPS/CA trust, no public IP/DNS, local logs and backups |
| `private-vpn` | P1 | Explicit VPN routes and ACLs, same cert/device policy as LAN |
| `public-cloud` | P2 | Public DNS/ACME, hardened ingress, customer consent, external availability/restore probes |

## Alternatives considered

- **Use Hostinger Business shared Node.js for every office:** rejected as default, because internet dependency, process/port constraints and tenant data custody conflict with offline first.
- **Run public DNS/ACME deployment inside LAN by inventing DNS:** rejected; a publicly trusted ACME flow is not equivalent to standalone air-gapped HTTPS.
- **Reintroduce FastAPI/PostgreSQL/Go stack:** rejected for this delivery cycle; huge migration risk and existing Node/MySQL acceptance evidence already exists.
- **Automatically disable TLS on intranet:** rejected; silent credential interception risk.

## Release gate

Architecture is not E2E accepted until `AT-LAN-01..07` and `AT-SEC-01..04` pass on representative local hosts with WAN intentionally disabled. A CI-only synthetic network does not close that gap.
