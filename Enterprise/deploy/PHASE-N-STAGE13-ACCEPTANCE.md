# Phase N Stage 13 — Explicit Workspace Membership and Global Configuration Boundaries

**State:** Stage 13 security and workflow code accepted by the latest four-job CI run (#43927772995). **Production rollout remains BLOCKED.** This is a code/CI acceptance report, not an operator-signed release or a live Hostinger deployment.

## Changes and trust boundaries

### Workspace membership

The additive migration `database/migrations/004_workspace_memberships.sql` creates `user_workspace_memberships` with an immutable user ID, target tenant ID, tenant-specific role, ACTIVE/REVOKED status and grant provenance. The existing primary workspace remains `users.tenant_id`; the migration idempotently records the primary memberships without overriding revoked rows. Existing tenant IDs and accounts are not rewritten.

The authorized API surface is:

- `GET /api/v1/workspaces`: shows only the account's ACTIVE workspaces (primary plus approved memberships); the legacy `GET /api/v1/tenants` no longer enumerates all tenants.
- `POST /api/v1/workspaces/select` with `{"tenant_id":"..." }`: checks the persisted account and target membership, then issues a **new signed tenant-role JWT** and refreshes the httpOnly session cookies. An arbitrary tenant ID in a URL/header/body is never proof of membership.
- `POST /api/v1/workspaces/memberships` with `{"user_id":123,"role":"OPERATOR"}`: destination workspace's authenticated SUPER_ADMIN can grant access to an existing enabled account. Destination tenant is derived from the actor's authenticated workspace; a caller cannot supply a different tenant.
- `DELETE /api/v1/workspaces/memberships/:userId`: same-tenant SUPER_ADMIN revokes secondary membership. Removing primary or own current membership is refused. A revoked or role-changed secondary membership invalidates old selected-workspace JWTs at the next authenticated request.
- The Enterprise web portal now displays an **Active workspace** selector in the sidebar. It offers only returned authorized workspaces; on successful switch it saves the new token and reloads the tenant-scoped page. Selection errors do not switch the session.

Primary workspace login remains compatible with earlier deployments. Secondary access fails closed if the membership table is absent, no active grant exists or the tenant is inactive. In production the JWT's role and tenant are revalidated against the current MySQL account and current tenant membership for user API, telemetry-user access and generated enrollment credentials.

### Platform-global settings

**Tenant SUPER_ADMIN does not imply platform-global privileges.** Production server-wide setup, alert webhook configuration/test, retention settings and purge, feature configuration and ticket integration configuration are gated by a separately designated platform operator. The explicit deployment settings are:

```dotenv
PLATFORM_ADMIN_USER_ID=<verified persistent SUPER_ADMIN user ID>
PLATFORM_OWNER_TENANT_ID=<the workspace UUID owned by the platform operator>
```

Place them in the privately secured `Enterprise/.env` and redeploy under operator change control. The Docker Compose API service passes these values through. Empty/missing or mismatched values **deny global operations by default** in production; no seeded demo account is automatically promoted to operator. Original `SETUP_TOKEN` approval is still required before initial setup.

The webhook GET response never serializes its secret token; webhook configuration audit events record changed field names, not submitted secret values. Reading/modifying globally shared retention/ticket settings remains restricted to the platform operator, **not** made tenant-specific.

**Default-company preference is tenant-local.** `GET/POST /api/v1/settings/default-company` consult the authenticated tenant's companies and store `tenant:<tenant_id>:default_company` in the settings table. A company from another tenant is rejected and the global branding/default-company record is never changed.

### Verification and release restrictions

- New unit tests: workspace membership/JWT role validation, SQL membership grant and revoke, strict tenant choice validation and platform operator fail-closed policy.
- New HTTP integration tests: unavailable workspace denial, role-injection rejection, authorized primary selection and fresh JWT, super-admin grant constraints and operator rejection from global settings.
- Real MySQL migration suite includes `004_workspace_memberships.sql`; the file and schema are present in both new installs and incremental upgrades.
- **Verified full CI**: https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43927772995 completed SUCCESS in all four mandatory jobs: PowerShell validation, Node/Vitest coverage, real MySQL 8/API integration and Windows agent EXE/MSI build with install/uninstall/major-upgrade rehearsals. CI uses disposable test infrastructure and diagnostic unsigned installer artifacts.

**Production acceptance is NOT granted**: operator-protected signing environment, trusted signed/public MSI, Hostinger DNS+HTTPS/deployment, audited production schema migration/restore and physical Windows first-run/reconfiguration are still operator-owned. The initial release also needs review of per-tenant customization for other globally shared settings and of invitation/consent workflows before unrestricted multi-organization onboarding.
