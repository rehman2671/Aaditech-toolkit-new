# Phase N Stage 18 — Closed remaining workspace audit, inventory and process-read boundaries

**Status: STAGE 18 CODE/CI ACCEPTED; PRODUCTION BLOCKED.** [PR #8](https://github.com/rehman2671/Aaditech-toolkit-new/pull/8) merged; [main CI #43982225279](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43982225279) **SUCCESS 4/4**, including diagnostic Windows MSI extraction, install/uninstall and major-upgrade rehearsals; [main safety #43982225214](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43982225214) **SUCCESS 2/2**. Signed public release, Hostinger live, real SMTP and physical Windows acceptance remain independently blocked.

## API containment

- `GET /api/v1/audit/logs`: the historic default-tenant SUPER_ADMIN shortcut could choose another tenant or omit the filter entirely. The API now always reads `req.user.tenant_id`, denies mismatched query overrides, and binds audit logs by tenant. Authorized platform operators must explicitly switch using membership-based workspace selection to inspect another tenant.
- `GET /api/v1/devices/:id/processes` and `.../app-usage` now enforce the same tenant ownership rule as `GET /api/v1/devices/:id`, returning 404 for foreign devices. App usage reads no longer consult a non-unique hostname-only Redis key; the globally unique device ID is required.
- `/api/v1/groups` and `/api/v1/policies` now list only tenant-filtered SQL records; new groups/policies carry the selected workspace tenant. Assigning a policy from another workspace to a group is rejected.
- `/api/v1/patches/summary` and patch approvals now store state per `tenant:<tenantId>:patchInventory`. No legacy shared global `patchInventory` setting is inherited; initial patch metadata never fabricates affected-device counts.
- Unit SQL and HTTP regression tests assert tenant predicates, per-tenant patch setting keys, audit override denial, and 404s for unowned device process/usage routes.

## Independent acceptance

- A successful CI suite cannot verify customer data migration on Hostinger, Authenticode publisher signature acceptance, actual SMTP relay/inbox delivery or managed physical Windows endpoint upgrade.
- Legacy global patch setting remains persisted but disconnected from tenant endpoints. Review and explicitly migrate per tenant only after operator authorization.

## Verified Stage 18 acceptance (2026-11-17)

- PR merge commit `74158915e153d1d95675ea20abe39a5dda907659`. [PR CI #43981861732](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43981861732) and [PR safety #43981861681](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43981861681) passed.
- [Main CI #43982225279](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43982225279) **SUCCESS 4/4** and [main safety #43982225214](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43982225214) **SUCCESS 2/2**.
- See `Enterprise/deploy/PHASE-N-PRODUCTION-RELEASE-CHECKLIST.md` for production owner acceptance; CI does **not** prove live deployment, production restore, real mailbox receipt, human-signed MSI or customer Windows approval.
