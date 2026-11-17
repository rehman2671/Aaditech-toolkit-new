# Phase N Stage 22 — Tenant/device event ownership instead of hostname joins

**Status: Code PR staged; independent CI and post-merge acceptance required. Production release BLOCKED.**

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
