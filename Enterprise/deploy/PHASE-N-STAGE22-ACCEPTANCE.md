# Phase N Stage 22 — Tenant/device event ownership instead of hostname joins

**Status: STAGE 22 CODE/CI ACCEPTED; PRODUCTION RELEASE BLOCKED.** [PR #12](https://github.com/rehman2671/Aaditech-toolkit-new/pull/12) merged. [Main CI #44043497516](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043497516) **SUCCESS 4/4**, including diagnostic Windows MSI install/uninstall/major-upgrade; [main safety #44043497509](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043497509) **SUCCESS 2/2**. Live Hostinger, customer DB restore, public signing, SMTP and physical Windows acceptance remain open.

## Cross-tenant finding and correction

Previously `GET /api/v1/events` and per-device reports fetched event rows using a SQL join `devices.hostname = events.hostname` because the legacy `events` table lacked tenant/device ownership. A hostname such as `DESKTOP-01` can legitimately exist in **two different workspaces**. If both devices shared that hostname, the join could return other organizations' event payloads, multiply counts, and make event ownership ambiguous.

- Migration `010_events_tenant_device_identity.sql` conditionally adds nullable `tenant_id`, `device_id` and indexed `(tenant_id, device_id, captured_at)` fields.
- Authenticated telemetry ingest writes the **credential-verified device's** tenant ID and globally unique device ID on every new event; client-submitted tenant identity is never trusted.
- Tenant-facing event reads now execute a direct `WHERE tenant_id = ?` SQL predicate on events rather than joining by hostname. Per-device reports additionally enforce `WHERE device_id = ?`. No user can select an arbitrary tenant through query parameters.
- **Historic rows stay NULL-owned**. Their tenant/device IDs cannot be safely inferred from hostname, so they are hidden from authenticated tenant APIs until operator-approved evidence-based remediation is possible.
- Device app-usage telemetry no longer writes the legacy Redis `app_usage:<hostname>` key, which was non-unique across workspaces. Current device ID cache remains.

## Acceptance and data migration policy

- Run MySQL schema migration 010 after an approved encrypted backup and verified **offsite restore** in a separate, disposable production-like environment.
- Real MySQL/API and Node/Vitest regression tests must verify direct tenant predicates and no hostname-based event ownership.
- Historic NULL event records are intentionally quarantined; never backfill from a hostname guess. Existing global platform metrics counts are separately operator-owned and inaccessible via public Caddy `/metrics` route.
- Public signed Windows MSI, actual Hostinger DNS/TLS/VPS, approved customer database restore, verified SMTP inbox, and managed Windows UAC/upgrade remain external acceptance gates.

## Independent acceptance evidence (2026-11-17)

- [PR CI #44043152228](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043152228) SUCCESS and [PR safety #44043152314](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043152314) SUCCESS after updating legacy hostname-JOIN unit assertions.
- PR merge commit `af72dabe41818b8403f8a97f714b41606e1a9880`.
- [Main CI #44043497516](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043497516) SUCCESS **4/4**: Node/Vitest, PowerShell, isolated MySQL/API fault injection, Windows EXE/MSI installation/uninstall/major-upgrade diagnostics.
- [Main deployment safety #44043497509](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44043497509) SUCCESS **2/2**. These disposable CI checks do not prove on-premises/customer cloud recovery or signed MSI release.
