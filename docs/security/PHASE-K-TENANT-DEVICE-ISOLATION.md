# Phase K — Tenant authorization & device identity isolation

**Status: draft security change, not a production multi-tenant certification.**

This branch is stacked on [Phase J PR #3](https://github.com/rehman2671/Aaditech-toolkit-new/pull/3), tracked in [Phase K PR #4](https://github.com/rehman2671/Aaditech-toolkit-new/pull/4). The source of truth remains MySQL, and `SUPER_ADMIN` means *administrator within an assigned tenant*, **not** unlimited access to every organization.

## Primary threats and implemented mitigations

| Threat / vulnerable path | Phase K mitigation |
|---|---|
| Signed JWT claims no longer match a live user, or user's tenant/role was changed | User ID, username, live role, active status and tenant are checked against the current DB account for every protected request. Missing/deleted/disabled/mismatched accounts fail with 401. |
| Cross-tenant device detail/list/delete or internal credential hash leakage | Tenant is derived from authenticated user, never an arbitrary `tenant_id` query. Unauthorized device IDs return 404. Detail and one-time registration responses remove stored agent token hashes/prefix. |
| Bootstrap token enrolling an already-registered hostname/UID and replacing its credentials | Enrollment rejects duplicates with 409 before consuming one-time bootstrap; new endpoints receive UUID-bound identity. No implicit credential rotation. Explicit approved re-enrollment/rotation workflow is required. |
| Device impersonation by a reused short hostname alias | Only exact hostname, device ID or registered UID is accepted; short-name/FQDN alias matching removed. |
| Agent token passed through URLs, JSON payloads or bootstrap headers | Production device authentication requires `X-Device-Token`, `X-Agent-Token` or Bearer. Token in URL/body is rejected. Enrollment remains POST-only; query credential/identity inputs rejected. |
| Device token revoked or rotated but old process-local auth cache still grants access | Production credential and device identity lookups consult authoritative MySQL, not per-worker in-memory fallback/cache. Device update evicts all associated local cache aliases. |
| Cross-tenant command dispatch/history/result | Dispatch requires target device tenant ownership; command history is filtered by device's tenant (the current queue schema has no tenant column); command result must match the owning device ID/tenant. |
| Cross-tenant users, reports, software, posture, processes, app usage, alerts, audit logs, groups/policies, companies or tickets | Tenant ownership/filtering enforced on the reviewed routes. New rules/groups/policies/users/companies inherit the actor's tenant. |
| Hostname-only legacy events reused by different tenants | Events/reports deny an ambiguous hostname shared across tenants. Application-usage cache is keyed by immutable device ID, not global hostname. |
| In-memory test SQL emulator data missing when MySQL transitions between states | Test-only fallback devices are merged and independently filtered by tenant/company/status; production never overlays in-memory agent records. |

## Regression tests

- `tests/unit/tenant-security.test.js`: tenant ownership including SUPER_ADMIN, redaction, live session binding, command result binding and ambiguous hostname collision.
- `tests/integration/tenant-isolation.test.js`: independent tenant administrators + devices; negative cross-tenant device detail/processes/report/users/commands/command results/enrollment takeover/JWT forgery and query override checks.
- `tests/integration/server.integration.test.js`: existing alert-rule lifecycle and remediation fixture updated to use real owned endpoints.
- `test-msi-packaging-integration.js`: requests a real authenticated admin JWT instead of a handcrafted `SUPER_ADMIN` token; hardening a test is preferable to weakening runtime authentication.
- The full CI includes Node/Vitest with MySQL 8, PowerShell validations, API integration, the Docker first-run smoke and genuine Windows EXE/MSI lifecycle.

## Critical release blockers **NOT fixed by Phase K**

1. **Database schema lacks comprehensive tenant composite constraints**. `command_queue` has `device_id` but no `tenant_id`; most `events` are hostname-only, so collisions are ambiguous. All resource relationships must be migrated to durable tenant-bound foreign keys and enforced at query/mutation boundaries.
2. **Enrollment/registration concurrency**: hostname/UID duplicate checks are application-level; the `devices` table has secondary indexes, not uniqueness guarantees for all logical identifiers. Competing enrollments and rotations require transactions, unique constraints and a reviewed migration path.
3. **Global configuration/secrets remain partly shared**: branding, webhooks, SMTP, retention, ticket integration and remediation settings need an explicit platform-wide vs per-tenant authorization/data model. Do not grant tenant admins shared-global settings until isolated.
4. **Bootstrap token persistence/rotation**: legacy MSI and used-token tables still contain raw token columns. Securely migrate to hashes only, transactional single-use, rate limiting and tenant-scoped admin issuance.
5. **Existing endpoint identity and version compatibility**: legacy short UIDs, shared credentials, fleet-wide tokens and hostname-based caches must have a planned re-enrollment migration; do not silently rotate devices.
6. **User and data creation/mutation consistency across replicas**: independent concurrency, hostile tenant IDs, SQL isolation, database outage and token revocation tests remain required. A locally passing test suite is not an independent audit.
7. Phase H/I/J release gates remain: security review, code-signing, real Windows 10/11 VM install/repair/upgrade/rollback, and approved certificate trust.

### Release decision

**BLOCK production multi-tenant use and unreviewed deployment.** The Phase K pull request is a layered defense and test foundation, not comprehensive tenant isolation. No unsigned agent binary should be distributed, and these stacked PRs should not be merged until prerequisites are reviewed.

### Review checklist

Confirm that human and device authentication depend on current DB credentials; test cross-tenant reads and writes on all endpoints including legacy aliases; verify two tenant admins named `SUPER_ADMIN` cannot affect each other; verify enrollment duplicate and concurrent requests; confirm revocation works across replicas; verify migration and rollback with audit logs. Document remaining intentionally global settings before accepting multi-tenant customers.
