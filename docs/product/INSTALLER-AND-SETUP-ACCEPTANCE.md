# One-click enterprise installation, first-run setup and recovery specification

**Mode default:** `intranet`. **This is a proposed acceptance contract, not a statement that the current Windows/Linux installer meets it.**

## What "one-click" means

An approved administrator starts a signed/local launcher, accepts OS elevation and enters only business-required information in a wizard. Preflight, runtime staging, database provisioning, secret creation, HTTPS binding and service startup are automated. The phrase **does not mean** bypass UAC, erase DBs, enroll other people's machines without consent, or automatically choose network trust.

## Phase 1 — preflight with zero mutation

- Support matrix for Windows Server and Linux releases, x64 CPU/RAM/storage, local admin rights, compatible virtualization and OS policies.
- Detect Docker/Compose or chosen bundled service manager, dependencies, MySQL volume, legacy files and existing installation identity **before** installation.
- Confirm selected network profile: LAN (default), private VPN or reviewed public. Prompt for bind interface, local hostname/IP and port conflicts.
- Choose internal PKI route: approved enterprise CA with server cert, or locally generated CA with an authenticated fingerprint/out-of-band root distribution process. No blind CA import.
- Confirm offline bundle integrity: pinned hashes, required signatures, images/packages, no network fetches if offline selected. Show actionable missing prerequisites.
- Existing service/volume with no identity/credential context => stop safely, no overwrite/secret rotation.

## Phase 2 — transactional infrastructure bring-up

1. Generate per-install DB and API secrets locally; protect via OS ACLs/private files. Never embed secrets in MSI, command line, source or console output.
2. Create or recover installation state and persistent `installation_id`. Generate once; backups capture it securely.
3. Provision/migrate MySQL with an idempotent, serialized migration runner; create safety backup before risky upgrade.
4. Bind Node.js API to protected local network, configure trusted HTTPS, API and database health; firewall rules scoped to selected office interfaces.
5. Open local setup URL only once readiness succeeds. Show meaningful rollback/retry instructions on failure; retain existing data.

## Phase 3 — first-run browser wizard

- **Identity:** company/office name, optional departments/workspaces, local installation ID displayed read-only.
- **Administrator:** unique username, strong password, designated platform owner, MFA decision (if/when supported); no shipped demo credentials.
- **LAN:** selected server URL and expected SAN, trust instructions for clients, reachability test from representative second machine.
- **Device policy:** signed generic MSI; per-device/bootstrap enrollment issuance; GPO/Intune/SCCM/manual deployment choice, never shared permanent token in MSI.
- **Data & recovery:** encrypted backup destination, retention, test-restore process, incident contact. Offsite means a different physical failure domain; in fully air-gapped offices allow encrypted removable-media export with a documented custodian.
- **Optional:** SMTP/webhooks, external ITSM, central registration, remote updates; *skip* cannot block local production.
- **Ready screen:** run host/MySQL/API/agent protocol validation, show exact pass/fail and evidence receipt; only then mark setup complete.

## Phase 4 — lifecycle

- Repeat install => recognize existing ID/secrets, offer update/reconfiguration, preserve tenants/devices and database.
- Change LAN DNS/IP => validate new HTTPS endpoint and agent trust; require approval before re-enrollment/rotation; never silently change identity.
- Migration/restore => check backup manifest, identity mode (replace existing vs separate clone), encrypted offsite copy, restore verification and rollback.
- Uninstall => service deletion and data-retention option clearly distinct; revoke device credentials on decommission, do not promise to wipe hidden backups or original secrets.
- Agent MSI configuration wizard can run *after MSI install* today. Opening an integrated server installer and device wizard at the right step is a target, not already implemented.

## Hard failures, not green UI

- No public domain, no internet, expired internal certificate, unknown CA, broken internal DNS.
- Unsupported OS, insufficient RAM/disk, no elevation, conflicting occupied ports, Docker unavailable.
- MySQL data directory exists but secrets are missing/mismatched; partial migration/power loss.
- Duplicate server installation ID after cloning, ambiguous device/tenant identity, cert SAN mismatch.
- Windows agent setup with token disclosure, filesystem world-readable private token, unsigned package, stale root trust.
- Interrupted install/upgrade; accidental reinstall must not destroy existing records.

## Acceptance evidence (required, not simulated by documentation)

`AT-LAN-01..07`: supported fresh installs (Windows + Linux where supported), browser wizard, *actual WAN disconnected* office-to-agent HTTPS, multi-host enrollment, two separately installed offices, signed upgrade, database restore.  
`AT-SEC-01..04`: TLS chain, secret ACLs, cross-tenant/installation denial, correct rollback.  
`AT-OPS-01..03`: signed release, offsite/air-gap recovery and administrator handoff.

Existing `Enterprise/deploy/deploy-mysql.sh` is a **public DNS/VPS** entrypoint, and `Enterprise/deploy/deploy.ps1` and `deploy.sh` are intentionally incompatible/blocked. This document must **not** be read as an instruction to run them for offline production today.
