# AadiTech Enterprise — master product requirements

**Version:** Planning baseline v1.0, 2026-11-23. **Status:** Proposed for independent review; no new implementation implied.

## Product definition

An **intranet-first, self-hosted IT operations platform** that can be deployed repeatedly in different independent enterprises. An authorized local administrator installs the server, completes the first-run setup wizard, installs/enrolls Windows endpoint agents, monitors their posture, receives issues, diagnoses problems, safely repairs permitted faults and measures *verified* outcomes. Central cloud services are opt-in additions only.

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

Mandatory Hostinger/VPS deployment, public internet, cloud backup, central SSO/MDM, trained AI diagnosis, autonomous high-risk repairs, full Apple/Linux endpoint coverage, and guaranteed resolution of physical/hardware faults are **not** release prerequisites. These are future choices rather than implied completed functionality.
