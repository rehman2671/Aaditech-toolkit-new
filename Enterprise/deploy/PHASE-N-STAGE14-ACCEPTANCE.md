# Phase N Stage 14 — Consent-Driven Workspaces, Tenant Configuration and Deployment Preflight

**Production status: BLOCKED.** Stage 14 automated code acceptance passed all four CI jobs in run #43933248099. Disposable CI is not a signed public Windows MSI, live Hostinger approval or customer machine acceptance.

## 1. Invitation and consent security

Stage 13 introduced explicit `user_workspace_memberships` for primary and secondary workspace access. Stage 14 now implements **invitation-only grants**; a destination-tenant SUPER_ADMIN cannot silently activate another user's membership:

- `POST /api/v1/workspaces/memberships` with `{"user_id":81,"role":"OPERATOR"}` creates `INVITED`, not `ACTIVE`. The server derives the destination tenant from the admin's authenticated JWT; a caller-supplied tenant override is rejected.
- `GET /api/v1/workspaces/invitations` returns ONLY the current authenticated account's pending invitations to ACTIVE tenants, valid for seven days. No invitation bearer secret appears in URLs, notifications or logs.
- `POST /api/v1/workspaces/invitations/:tenantId/accept` atomically changes only that account's unexpired `INVITED` record to `ACTIVE`, if the destination tenant and target account are still ACTIVE.
- `POST /api/v1/workspaces/invitations/:tenantId/decline` atomically records `DECLINED`. Expired, duplicate, revoked and already-answered invitations fail (HTTP 409). Re-inviting an already ACTIVE member cannot silently escalate their role.
- `DELETE /api/v1/workspaces/memberships/:userId` by a tenant SUPER_ADMIN revokes both ACTIVE and unaccepted INVITED records, but cannot revoke primary ownership or the actor's own active membership from that endpoint.
- The Enterprise portal sidebar now exposes **Workspace invitations** with real Accept and Decline controls. Acceptance only makes the new tenant selectable; switching context is a separate explicit action issuing a new signed tenant/role JWT.

**No schema migration needed:** Stage 14 reuses the Stage 13 membership row's `status`, `updated_at` and `granted_by`; seven-day expiry is enforced inside the conditional MySQL UPDATE. Already ACTIVE memberships created under Stage 13 remain ACTIVE. In-app acceptance does not email an invite or automatically create a user account; the invited user must already exist.

## 2. Tenant-specific settings and additional isolation

- Tenant brand presentation uses `tenant:<tenantId>:branding` and strict fields `company_name`, `logo_text`, `color`. `GET /api/v1/workspaces/branding` is authenticated; `PUT` requires the selected tenant's SUPER_ADMIN. Uncustomized values inherit safe operator visual defaults, not another tenant's overrides. Neither hostname nor global setup secrets can be changed through branding.
- `GET/PUT /api/v1/tickets/config` now access `tenant:<tenantId>:ticketConfig`, with mutations restricted to tenant SUPER_ADMIN. A tenant's ticket URL/project settings never inherit another workspace's configured integration. Ticket list and created tickets are bound to authenticated `tenant_id`.
- Alert count, alert rules (read/create/update/delete), individual alert acknowledgement/resolution and cloud compliance device summaries have tenant ownership guards. Tenant SUPER_ADMIN is not a platform-wide account.
- The existing platform-global retention, signing and server setup settings remain separately restricted; tenant settings do not change platform credentials.

## 3. Hostinger configuration and release readiness

This phase adds a **non-mutating configuration preflight**:

```bash
bash Enterprise/deploy/preflight-stage14.sh --env-file Enterprise/.env
# Stronger gate for an approved, independently signed release:
bash Enterprise/deploy/preflight-stage14.sh --env-file Enterprise/.env --release
```

The script validates private file permissions, uniqueness/length of required secrets, DNS hostname consistency, MySQL identifiers, the designated platform operator's persistent ID and workspace UUID, and the separately recorded release MSI SHA-256. It reads `.env` as literal data rather than sourcing it, does not print credentials and does not touch containers or servers. `--release` **does not cryptographically verify Authenticode**: the human reviewer must verify signer certificate, protected GitHub release approval, exact artifact digest, actual target host TLS, restore ability and physical Windows installer workflow.

`Enterprise/.env.example` now documents `PLATFORM_ADMIN_USER_ID` and `PLATFORM_OWNER_TENANT_ID`. Missing global operator identity denies global setting edits in production. The initial setup wizard requires the independent long `SETUP_TOKEN`.

## 4. CI acceptance evidence

- Unit tests: `tests/unit/workspace-invitation-consent.test.js`, `tests/unit/tenant-config-stage14.test.js`; replay, expiry, role isolation and SQL tenant keys.
- HTTP regression: `tests/integration/workspace-selection.integration.test.js` includes invitation authorization/invalid requests, tenant branding and ticket config RBAC, alongside existing workspace selection tests.
- Real MySQL rehearsal: `test-workspace-invitations-mysql.js` is gated to GitHub Actions disposable `it_toolkit` and checks pending/accepted/declined/revoked/expired states, replay/refused escalation and two-tenant ticket config isolation. The main `.github/workflows/ci.yml` runs it after schema migrations.
- Offline production readiness: `Enterprise/tests/Test-Stage14Preflight.sh` checks positive/negative config and release input; `.github/workflows/deployment-safety.yml` enforces it alongside existing isolated backup/restore tests.

Latest deployment-safety run:
https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43931969524

Latest full CI acceptance run:
https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43932726029

**Verified:** All four jobs in [full Stage 14 CI #43933248099](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43933248099) completed SUCCESS: PowerShell validation, Node/Vitest tests and coverage, real isolated MySQL/API integration including invitation consent/replay/expiry/tenant settings, and Windows EXE/MSI packaging with install/uninstall/major-upgrade rehearsals. [Deployment-safety #43931969524](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43931969524) also completed SUCCESS for offline signed-release preflight controls and disposable MySQL backup/restore regression.

Operator-signed public release and live infrastructure/physical customer Windows evidence are **independent and still missing**.

## 5. Remaining production acceptance

- Hostinger VPS details (actual eligible VPS, Docker, persistent MySQL, DNS, Caddy/ACME HTTPS, firewall and recovery access) must be finalized on the actual host.
- Human-approved protected GitHub signing environment, genuine Windows certificate/private-key custody, published Authenticode-signed MSI, SHA-256 pin and download verification.
- Real MySQL migration/backup-offsite/restore rehearsal using deployment data and controlled maintenance window.
- Representative Windows UAC install/uninstall/major upgrade, first-run config wizard, customer tenant selection and later server URL editing on physical devices.
- Tenant-specific customizations for other global integrations and a reviewed external invitation notification workflow remain potential follow-ups; do not claim them complete.
