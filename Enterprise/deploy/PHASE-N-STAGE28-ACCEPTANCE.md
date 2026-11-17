# Phase N Stage 28 — Durable event ID safety under retries

**Status: CODE PROPOSED — CI PENDING; PRODUCTION BLOCKED.**

Stage N27 deliberately retries local SQLite events on lost acknowledgment.
Old server ingestion appended every retry, and `hostname:<row-id>` could
collide after a clean reinstall of the SQLite queue.

Migration 013 adds nullable `client_msg_id`, nullable server-calculated
`event_hash`, and case-sensitive UNIQUE
`(tenant_id, device_id, client_msg_id)`. Historic NULL keys are preserved.
Atomic MySQL duplicate-key insertion with a persisted insertion-winner nonce (required because MySQL FOUND_ROWS returns affectedRows=1 even for a duplicate no-op) resolves exact concurrent retries without
a new row. Changed content under an existing key raises HTTP 409 instead of
silently acknowledging altered events. Owner identity is from authenticated
tenant/device, never hostname.

Windows MSI agent now generates and persists a random SQLite queue-instance
UUID and sends `<queue-instance>:<row-id>`. Ordinary upgrades retain the
SQLite queue and ID, fresh reinstalls get a new random ID. Older unkeyed
events remain append-only, and oversized batches / malformed IDs fail schema
validation.

## Acceptance gates

- [ ] PR Node/Vitest, PowerShell behavioral tests and real MySQL/API 24-way concurrency plus deployment-safety all pass.
- [ ] Main genuine diagnostic Windows ps2exe/WiX MSI build, extraction, install/uninstall and major upgrade passes.
- [ ] Physical customer-enrolled Windows ACK-loss retry, fresh queue on reinstall, upgrade preserving identity.
- [ ] Authorized production encrypted backup/offsite restore before migration 013, Hostinger DNS/TLS and ownership.
- [ ] Public Authenticode signature, real SMTP/webhook recipient and external Graph/ITSM integrations.

**Scope:** Only `events` table rows are deduplicated. An entire HTTP replay
may create new telemetry history/alerts; notification delivery also remains
at-least-once. No end-to-end exactly-once claim.
