# AadiTech Enterprise — master product requirements

**Version:** Planning baseline v1.1, 2026-11-23. **Status:** Proposed for independent review; no new implementation implied.

## Product definition

An **intranet-first, self-hosted IT operations platform** that can be deployed repeatedly in different independent enterprises. An authorized local administrator installs the server, completes the first-run setup wizard, installs/enrolls Windows endpoint agents, monitors their posture, receives issues, diagnoses problems, safely repairs permitted faults and measures *verified* outcomes. Central cloud services are opt-in additions only.

## Original-source preservation

The [34-section original requirements crosswalk](ORIGINAL-REQUIREMENTS-TRACEABILITY.md) tracks original mandatory feature families, including multi-OS agents, signed portal-generated MSI, per-process network/app metrics, configurable weighted health scoring, scheduled CSV/Excel/PDF reports, agent lifecycle and HA/observability. None is waived by the intranet-first phased plan. The original Go/PostgreSQL lock conflicts with the checked-in Node/MySQL code; **owner ADR DEC-001 must decide this material deviation**.

## People and access model

- **Installation operator:** controls host prerequisites, offline bundle, network identity, local PKI, encrypted backups and recovery.
- **Platform administrator:** owns one installed server's global settings and initial security setup; never automatically inherits all other offices' data.
- **Tenant administrator:** manages that installation's authorized workspace users/devices/policies; does not own host signing keys.
- **IT technician/operator:** investigates incidents and requests approved remediations, within role scope.
- **Employee:** optional self-service issue reporting and transparent consent; no admin credentials required to describe a fault.
- **Security/auditor:** sees appropriately redacted, tenant-scoped, immutable evidence; operator approver and executor separation on high-risk actions.

## Mandatory functional requirements

| ID | Priority | Required behavior / verifiable acceptance |
|---|---|---|
| PR-001 | P0 | **Intranet default.** After installation, dashboard, API, local DB, agent enrollment, telemetry, safe commands, local alerts and reports work with WAN physically disconnected; no request to `tool.aaditechs.in` is required. |
| PR-002 | P0 | **Deploy in an authorized office.** Supported Windows Server/Linux hosts use one guided installer/launcher, deterministic prerequisites, correct MySQL migration, persistent storage, local firewall/HTTPS and actionable failures; no routine manual `.env` editing. |
| PR-003 | P0 | **Post-install browser setup.** Operator creates company/workspace, admin login, selected local endpoint, trust settings, backup configuration; optional external services can be skipped. Required secrets are generated locally, protected, never shown in process arguments or logs. |
| PR-004 | P0 | **Independent installation identity.** Generate a random, persistent `installation_id` at first initialization. Unique across separately installed offices, preserved on upgrade/restore of the *same* installation, explicitly rotated on cloning into a *new* installation. Distinct from `tenant_id`, `user_id` and `device_uid`. No mandatory central registration. |
| PR-005 | P0 | **Secure local agent enrollment.** Generic signed MSI has no embedded tenant or shared bootstrap credential; authorized local enrollment creates per-device identity bound to one installation and tenant. Console/GPO/bulk options supported after consent/authorization. |
| PR-006 | P0 | **Tenant isolation.** User, device, command, telemetry, ticket, alert and remediation records stay tenant scoped; cross-tenant and ambiguous legacy identity paths fail closed. |
| PR-007 | P0 | **Health/recovery.** Local readiness, durable backups, encrypted off-host copy or disconnected-media export, tested restore, failed-migration rollback plan and power-loss/DB outage behavior must have evidence. |
| PR-008 | P0 | **Upgradeable without re-enrollment by default.** Agent and server upgrade preserve identities, secrets and configuration unless explicitly rotating/migrating; safe rollback or recovery is documented and tested. |
| PR-009 | P1 | **Employee self-service.** A local user can submit one of the 26 recognized support issues with device and consent context; cannot trigger privileged arbitrary scripts. |
| PR-010 | P1 | **Controlled automated remediation.** Diagnostics and repair playbooks are signed/allowlisted, versioned, tenant/device-scoped, policy-authorized, idempotent and have bounded retries/rollback and approval gates. |
| PR-011 | P1 | **Verified resolution metrics.** Every attempt has before/after evidence; command ACK is not proof of resolution. Dashboard separates diagnosed, attempted, verified-resolved, user-confirmed, escalated, unresolved and reopened. |
| PR-012 | P1 | **Manageable by local admins.** Update safe network/host/backup/tenant configurations through authenticated setup/settings without reinstalling or losing device keys. |
| PR-013 | P2 | **Optional central endpoint.** `tool.aaditechs.in` *may* later offer support requests, update manifests, licensing or voluntary installation registration. Any synchronizer is disabled by default and never uploads sensitive inventory without explicit organization policy. |
| PR-014 | P2 | **Future external connectors.** Microsoft Graph/Intune, external ITSM and SMTP/cloud notifications are separately configured, clearly marked disconnected when absent; not a local product prerequisite. |

## Preserved original mandatory scope (not yet fully implemented)

| ID | Original obligation retained | Current implementation boundary |
|---|---|---|
| PR-015 | Windows, macOS and Linux agent parity, secure enrollment and OS-specific collectors | Windows-focused; other OS acceptance missing |
| PR-016 | First-class **server-side signed MSI Package Factory** with tenant/group/policy selection, versioned metadata, auth downloads, revocation and short-lived bootstrap | Generic diagnostic MSI and API are not the completed full factory |
| PR-017 | Full real hardware/CPU/RAM/GPU/network/disk/battery/process telemetry with 1h/24h/7d/30d charts and policy intervals | Partial measured metrics; no invented values |
| PR-018 | Configurable, explainable weighted 0–100 Device Health Score | Not independently proven |
| PR-019 | Agent service/update/config/tamper/rotation/decommission lifecycle, durable offline queue | Partial Windows task and token/ACK coverage |
| PR-020 | Asset/site/department/group ownership, fine-grained RBAC, policy precedence and configuration versioning | Partial records/roles |
| PR-021 | Tamper-resistant audit, tenant privacy/retention, PDF/Excel/CSV and scheduled filtered reports | Basic CSV and audit code; remainder unproven |
| PR-022 | Platform observability (worker/queue/DB/API/ingest/package metrics), scale, HA and disaster recovery | Healthz and isolated reliability tests only |
| PR-023 | Privacy-safe per-process application usage, crash history, foreground and network metrics | Partial processes and usage endpoints |
| PR-024 | Complete alert recovery, cooldown, maintenance and configured notification channels | Partial alert/outbox, external delivery optional/configured |
| PR-025 | Controlled AI-assisted diagnostic/tool boundaries; no uncontrolled privileged execution | Proposed safety requirement, not built AI solver |
| PR-026 | Atomized RTM, contract/source traceability and reviewed ADR for material design changes | Section-level RTM exists; detailed atomic RTM pending |
| PR-027 | Original Windows **service** requirement vs current scheduled-task worker | DEC-003 requires owner decision/implementation |

These are original-scope obligations (possibly phased only with owner approval), **not optional scope that this PRD removed**.

## Operating modes (design targets, not current promises)

1. **Office intranet (default):** single local installation, no public DNS or internet, private trusted HTTPS, data stays local.
2. **Private multisite:** optionally company VPN and internal DNS; no mandatory public service.
3. **Opt-in public/cloud:** additionally reviewed DNS/TLS/egress, firewall exposure, recovery and tenant controls. Never auto-enable when LAN mode selected.

## Quality and safety constraints

- Use **currently implemented Node.js/Express, MySQL 8, browser portal and Windows PowerShell/WiX agent** as the baseline. Do not silently rewrite backend as FastAPI/PostgreSQL, Go/PostgreSQL or an unapproved new data plane.
- All secrets encrypted or OS-permission-protected; credentials do not appear in MSI, scripts/logs, URL query strings or clipboard by default.
- Fail **closed** on unsupported local TLS chain, unsigned installer, insufficient privileges, unknown tenant or unapproved script. Never make an agent trust any arbitrary self-signed certificate.
- Local-only deployments must explicitly bundle/cache permitted runtimes, container images and signed installer dependencies (or flag a missing prerequisite *before* mutation).
- Repairs must never silently disable Defender/firewall, security/audit agents, enterprise policy, encryption, recovery protection or crucial services. No irreversible/destructive changes without human authorization.
- Privacy: user-level diagnostic activity only when job-related, necessary, transparent, tenant-scoped and retention-limited. No covert screen/app or personal content surveillance.

## Definition of done

Product is **not** complete when the route builds or CI is green. At minimum prove: fresh install on each supported server OS; browser configuration; WAN-disconnected operation; two independently deployed office IDs; multi-device enrollment; cross-tenant refusal; monitored diagnostics; authorized command and reliable receipt; backup/restore; upgrade; and clean failure paths. Security owner verifies signer and infrastructure. See `ACCEPTANCE-TEST-MATRIX.md`.

## Explicit non-goals for first intranet release

Mandatory Hostinger/VPS deployment, public internet, cloud backup, central SSO/MDM, trained AI diagnosis, autonomous high-risk repairs and guaranteed resolution of physical/hardware faults are **not** first LAN-release prerequisites. **macOS/Linux support remains mandatory for the original complete-product scope**. Deferring parity to a later milestone is a proposed scheduling choice requiring DEC-002 owner approval, not a scope deletion.
