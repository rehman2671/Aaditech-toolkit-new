# Database Migrations Architecture

**Engine**: MySQL 8.0+ / MariaDB 10.4+ (Authoritative Single Database Engine)

This directory contains ordered, idempotent, versioned schema migrations managed by the enterprise migration runner in `db.js`.

## Migration Sequence

1. `001_init_schema.sql`: Core relational schema (tenants, companies, users, devices, process/patch inventories, command queue, packages, tickets, system settings).
2. `002_partitioning.sql`: Time-series telemetry table (`telemetry_history`) with MySQL-native range partitioning `PARTITION BY RANGE (TO_DAYS(recorded_at))` and composite primary key `(id, recorded_at)`.
3. `003_rbac_and_audit.sql`: RBAC, immutable audit logging (`audit_logs`), alerting engine (`alert_rules`, `alerts`), fleet device groups, telemetry policies, and idempotent bootstrap seed accounts.
4. `004_workspace_memberships.sql`: explicit per-user tenant roles, revocation and idempotent primary-workspace backfill.
5. `005_remediation_tenant_logs.sql`: conditionally add nullable tenant ownership to historic remediation logs and a `(tenant_id, executed_at)` index. Existing NULL-owned rows deliberately remain quarantined; never infer ownership from hostnames.
6. `006_notification_outbox.sql`: durable tenant-bound alert email/webhook queue with unique `(alert_id, channel)`, claim leases, bounded attempts, backoff, dead-letter and per-tenant status queries.
7. `007_scrub_legacy_github_pat.sql`: remove historical plaintext `branding.github_token` from persisted global settings, with no migration logging of the credential.
8. `008_scrub_legacy_ticket_keys.sql`: remove historical `api_key` fields from tenant and legacy global ticket configuration records. Both migrations are data hygiene steps, not live external integrations.
9. `009_notification_destination_binding.sql`: add nullable, keyed destination fingerprint to the MySQL outbox. Historic unbound queued jobs stay NULL and are **SKIPPED** by dispatchers, rather than sent to a new address/URL on subsequent opt-in or configuration changes.
10. `010_events_tenant_device_identity.sql`: add nullable tenant/device ownership and index to event logs. Legacy rows remain NULL (never inferred from potentially duplicate hostnames); new verified agent events are tenant-bound at insert.
11. `011_security_posture_provenance.sql`: add nullable server-owned enrolled-agent posture evidence timestamp and neutral new-device security defaults. Historic optimistic values remain unverified until fresh authenticated telemetry arrives.
12. `012_measured_device_telemetry.sql`: add nullable server-owned metric evidence timestamp, neutral CPU/RAM/disk/battery/total-capacity defaults and nullable missing history samples. Historic default values remain unverified.
13. `013_events_idempotency.sql`: add nullable per-event message keys, server-side content digests and insertion-winner nonce, plus unique tenant/device/message index. Historic NULL-owned and unkeyed events remain unmodified.
14. `014_telemetry_batches.sql`: add a transaction-bound SHA-256 receipt keyed by enrolled tenant, device and client batch ID. No historic rows are modified.
15. `015_batch_receipt_retention_index.sql`: indexed age metadata for read-only retention reports and explicitly confirmed bounded cleanup of receipts belonging only to fully decommissioned tenants with zero registered devices.

## Migration Runner & Concurrency
- Tracked via the `schema_migrations` table (`version`, `name`, `applied_at`, `execution_time_ms`, `checksum`).
- Multi-instance concurrency protected via MySQL distributed application lock: `SELECT GET_LOCK('itk_schema_migrations_lock', 15)`.
- Applied exactly once, in deterministic numeric order.
- Partition maintenance (`maintainTelemetryPartitions`) automatically generates forward monthly partitions and prunes partitions beyond data retention policies.

## Stage N17/N18 production upgrade notes

- Back up and verify restoration of the current production database **before** running new migrations on the authorized Hostinger VPS.
- The application startup migration runner is ordered and versioned; stage 005 preserves unowned historical logs as `NULL`, invisible to tenant-specific queries.
- Stage 006 delivery jobs are created only for enabled channels at alert creation. A background worker uses MySQL claim leases and exponential retry; a completed relay request can be delivered more than once if a worker crashes before its database acknowledgment. Treat it as **at-least-once**, not exactly-once.
- These migrations and tests have been rehearsed in disposable CI MySQL only; live production migration and recovery evidence must be signed off independently.

## Stage N19/N20 rollout safeguards

- Before running 007/008 on any real customer data, obtain an approved encrypted backup and prove restoration into a separate production-like environment.
- The application now reads GitHub build credentials exclusively from private `GITHUB_ACTIONS_REPO`/`GITHUB_ACTIONS_TOKEN` variables. Stored historical PATs should be removed by 007; the setup wizard must never collect one again.
- Ticket provider URLs are metadata only. New browser ticket API keys are rejected, and legacy keys are redacted prior to 008 being deployed. The ticket creation API writes **local** helpdesk rows only, never Jira/ServiceNow/Zendesk.
- Microsoft Graph is **NOT CONNECTED** without actual token acquisition and verified API responses, even if Azure client identifiers exist in environment settings.
- GitHub CI migrations on disposable MySQL do not substitute for a supervised live-production migration, rollback or offsite restore test.

## Stage N21 outbox migration safety

- Use the authorized encrypted backup/restore rehearsal before executing `009` on a production instance. Migration checks `information_schema` before altering the table and keeps older rows nullable, not guessed or silently rebound.
- New alert jobs persist an HMAC-SHA256 digest of tenant, channel and exact configured endpoint using private `HMAC_SECRET`. No webhook URL, email address or SMTP credentials are written into destination fingerprint field. Changing `HMAC_SECRET` will intentionally invalidate and skip existing pending outbox jobs; treat it as a credential-rotation operational change.
- Current consent **and** exact destination matching are required at send. Changes in URL/recipient quarantine old pending records as SKIPPED, rather than retrying forever or exposing old alerts to the replacement target.
- 20 jobs process in batches of five with up to 30s per SMTP send; 300-second lease prevents ordinary batch processing from outliving its ownership. Late stale acks are fenced by database lease token; worker reports lost-lease separately from delivered counts. Delivery remains at-least-once after accepted-response crashes, never exactly-once.

## Stage N22 tenant event migration

- Migration 010 uses information_schema feature detection to avoid duplicate ALTERs and is safe to rerun. No historical row is assigned to a tenant automatically.
- New event writes require an enrolled, credential-verified device tenant+ID in production. `GET /api/v1/events` filters `events.tenant_id` directly; per-device history also filters `events.device_id`. A duplicate hostname in another workspace cannot satisfy these predicates.
- Existing unowned events are retained for operator-only incident review under approved handling, but hidden from tenant APIs rather than exposing ambiguous data. Restore backup before any customer DB migration.

## Stage N24 security posture evidence rollout

- Backup/restore into a separate authorized environment before running `011` on customer MySQL. The migration is idempotent and does not guess whether historical healthy values were ever measured; existing `posture_reported_at` is NULL.
- Security/compliance endpoints require device-bound server-stamped telemetry not older than 24 hours; registration, heartbeat or a SQL default never grants a compliant verdict. Unknown and stale fields return null; `N/A` is reported for metrics without a trustworthy denominator.
- The agent must be upgraded to stop optimistic PowerShell collector fallback. Microsoft Graph/MDM attestation is still NOT_CONNECTED; even an enrolled agent report is device-reported, not independent security attestation.

## Stage N25 device metric provenance

- Execute migration 012 **only after an authorized offsite MySQL backup and recovery rehearsal**. SQL preserves historic values; tenant APIs hide usage metrics lacking trusted `telemetry_reported_at` until the enrolled agent submits fresh numbers.
- New device registration is `registered`, not automatically online; 15-minute metric freshness is independently checked from heartbeat/check-in. Battery stays unreported until an actual battery collector exists.
- MySQL history now stores NULL for omitted samples, not artificial zeros. Predictive disk analytics demands at least five measured samples across an hour, a recent last sample and current fresh metric evidence; zero consumption is not replaced with a positive fake baseline.
- Fixture/CI Windows MSI and disposable MySQL testing do not certify public signing, live customer Hostinger or physical Windows operation.

- Stage25 also fixes the process-table MySQL INSERT column/value mismatch (explicit `updated_at`), prevents production reads of shadow process fixtures, and limits live process/app-usage disclosure to a 15-minute authenticated telemetry window. Predictive analytics inspects at most 256 recent samples to cover a one-hour trend at typical 30-second device poll intervals.

## Stage N28 event retry hardening
- Upgrade with a verified offsite backup/restore before migration 013 on a real server. Existing NULL client IDs deliberately bypass the new unique index.
- MSI worker persists a unique per-SQLite-queue random identifier; upgraded existing queues keep the identifier, fresh queues use a new one. Message key = `<instance-id>:<row-id>` and is stable on every retry.
- Only authenticated tenant/device ownership scopes the MySQL idempotency index; hostnames are never trusted identities. Event content SHA-256 is server-calculated. Same key with different content raises HTTP 409 and does not acknowledge an altered event.
- Legacy unkeyed events are append-only. Full HTTP request replay, telemetry history, alerts, external hooks and SMTP delivery are **not** exactly-once.
- CI disposable MySQL and Windows diagnostic MSI acceptance are not evidence of a real signed public release or customer deployment.

## Stage N29: atomic authenticated telemetry replay

- Requires approved customer encrypted MySQL backup and separate offsite restore rehearsal before migration 014 in production.
- Canonical Windows agent persists the exact in-flight HTTP JSON body in local SQLite until a matching batch-ID and accepted-count ACK. An unsuccessful send retries identical bytes, not a new measurement with an old ID.
- A keyed HTTP batch persists the receipt, device evidence, measured history, process inventory, events, alerts and authorized notification outbox inside one InnoDB transaction. On error, everything rolls back. The unique tenant/device/batch index serializes concurrent PM2 workers. Matching replay returns original ACK; reused key with altered body returns HTTP 409.
- Unkeyed legacy clients remain supported without transaction-level dedup guarantees. Actual SMTP/webhook delivery is still at-least-once. Cache invalidation and public signed MSI/Hostinger deployment/physical device evidence are not inside this DB transaction.

## N30 safe receipt retention policy

- SHA-256 keyed batch receipts are compact deduplication tombstones: do **not** prune them based only on ordinary telemetry-history retention or device inactivity. Pruning an active tenant's receipt may allow an old HTTP replay to create history and alerts again.
- `maintainTelemetryBatchReceipts()` defaults to **DRY_RUN**. An actual purge needs operator confirmation `PURGE_DECOMMISSIONED_BATCH_RECEIPTS`, minimum age 180 days, max 500 rows per call, and **both** tenant record and ALL of its registered device records must be absent at deletion time. The conditional SQL rechecks both predicates atomically. No scheduled automatic delete exists.
- Review operator output and an independent tenant deprovision/backup process before authorizing cleanup. Safe storage sizing/retention policies for active tenants must not silently revoke retry guarantees. Public signing/Hostinger/physical-device checks remain separate gates.


## Phase O migration 016 — app-usage provenance

One bounded snapshot per device inside mandatory keyed telemetry. No Redis backfill or deployed fallback. Current unique active credential and tenant must match; 15-minute freshness, explicit empty observation, no replay overwrite. Verify backup/restore and migration on staging before production.


## Phase O exact-head verification and coverage recovery (2026-11-24)

Master #109 exact head 1c90d4492ecb8f192c28203bac502f772549651f CI #45456930486 4/4 executed SUCCESS (Node, PowerShell, real MySQL API, unsigned Windows MSI); deployment safety #45456930417 SUCCESS. Protected signed build skipped. #111 exact b1ff5176 CI #45457267890 all 483 tests/74 files passed, but statement coverage 69.73% below unchanged 70% threshold; API skipped. Added focused snapshot read/write, explicit empty/absent, duplicate receipt, invalid data, credential, rollback and DB-unavailable tests without reducing coverage gate. Fresh CI required; migration 016 staging backup/restore and physical source acquisition pending. Master quarantine/reconciliation verified at prior exact head, replacement issuance/independent ownership and secure handoff remain blocked.


## Phase O durable review reservations (2026-11-24)

Master #109 87e6a504 CI #45458997023 Node passed, API failed in identity-concurrency child process exited before reporting result (0); safety #45458997283 passed. IPC harness now awaits send completion and observes close instead of exit, without weakening race assertions. Source #111 6240cf59 CI #45458699873 all three executed jobs passed. Migration 017 adds persistent review-only requests and one-time signed review reservations (not activation grants), with revoked unique current credential, no unresolved commands, active persisted SUPER_ADMIN, distinct requester/reviewer, DB clock, same device-row lock, exact pins, pending-state CAS and atomic audit. Mock negative coverage and isolated real MySQL concurrent request/reservation test added. No HTTP route, grant consumption, credential issuance, independent key custody or endpoint proof; staged migration/backup, actual ownership, uncertain-command resolution and secure Windows handoff remain required. Fresh combined CI required; production not accepted.

## Phase O parallel compatibility, receipt and restore safety batch (2026-11-25 IST)

Exact head 73eee3c56c7ecfe96ef67c24043287a6aca1bb4b: CI 45461689851 Node/Vitest and real API/MySQL succeeded; PowerShell 7 actual verifier and junction containment fixture passed, but Windows PowerShell 5.1 full agent parsing failed near certificate expiry logging (UTF-8 without BOM/non-ASCII punctuation). Unsigned MSI skipped after prerequisite failure; protected signed MSI skipped. Deployment safety 45461689850 succeeded. Do not claim full acceptance.

Parallel batch: canonical worker normalized to ASCII without changing runtime logic to address 5.1 decoding; retained actual PS 5.1 command verifier gate. Heartbeat and telemetry POSTs disable redirects, have bounded 15-second timeout and terminating errors. Durable telemetry ACK requires typed status/batch ID, integer accepted count, Boolean duplicate, parseable recorded_at; malformed receipts retain identical outbox bytes; PS 7/5.1 cadence fixtures extended. Signed recovery-evidence verifier rejects newline-tailed exact-length UUIDs and digests even with matching pinned context, negative signatures tested. Isolated MySQL backup/restore rehearsal reapplies migrations 016/017 idempotently, seeds synthetic revoked device, sealed batch receipt, usage snapshot, and review reservation, deliberately mutates/deletes them, verifies exact restored state and unique recovery challenge constraint. No production restore or encryption claim; fresh CI required. No activation, collection of private usage, or architecture approval.

Migration rehearsal uses existing disposable CI database and current schema, not an old-production-schema upgrade, encrypted off-site backup, or rollback-safe live migration. Actual usage collector remains gated by DEC-002 privacy approval; deployment implementation by DEC-001; recovery issuance by DEC-003/independent custody, local handoff and physical acceptance. No main merge, signing or production acceptance.

## Phase O parallel replay compatibility, restore input integrity and review lifecycle (2026-11-25 IST)

Exact head cbc28e7aa4f24471e80f425a837d97a15fbf2885: CI 45462429321 Node/Vitest and API/MySQL passed; native Windows PowerShell 5.1 and 7 signed command verification/script containment passed; PS7 strict telemetry cadence passed, PS5.1 single-event lost-ACK retry assertion failed, unsigned MSI skipped. Safety 45462429336 both jobs passed, with actual security-state restoration and duplicate challenge refusal confirmed in job 138688350821.

Parallel batch: normalize SQLite JSON array parsing across PS5.1/7 by assigning decoded arrays before normalization; retain immutable stored batch, validate positive distinct bounded event IDs, stored body batch ID/event count and corresponding client ID suffix before sending. Multi-event/corrupt-ID regression and safe fixture logging added. Restore stages SQL and sidecar in a private temporary directory before validation; import staged bytes, not a mutable source pathname; fake Docker test replaces original after validation and verifies original staged bytes imported. Internal read-only inspectRecoveryReview validates persisted request scope, state/time, generation and current active admins under locks, returns categorical pending/reserved/expired/stale status with no proof secrets or activation, mock and real MySQL coverage. Fresh CI required; no new migration, no issuance, no HTTP endpoint. Staged restore remains plaintext, not protection against a privileged attacker or replacement of both source and checksum before validation.

Retain PS5.1 gate and exact receipt checks, do not weaken acceptance. Independent evidence custody, approved activation policy, secure Windows handoff, encrypted offsite backup and operator restore approval remain required. DEC-001/002/003 decisions not inferred; no main merge, signing or production acceptance.

## Phase O parallel incident persistence, signed setup display binding and restore continuity (2026-11-25 IST)

Exact head 8d33c0c1572e12225793614cd811388635c7523c: CI 45477940714 four executable jobs passed, including unsigned MSI lifecycle; protected signing skipped. Deployment safety 45477940884 both jobs passed; real job 138743032490 logs explicitly confirm authenticated AES-GCM disposable MySQL dump recovery and preserved credential revocation, receipt, usage snapshot and review reservation.

Parallel batch: migration 018 and baseline schema introduce internal technician categorical incident intake; authenticated caller and installation identity remain trusted-adapter prerequisites. Active current tenant SUPER_ADMIN and exact device scope locked in transaction, installation/tenant/actor/request idempotency, conflicting retries denied, one atomic audit, redacted own-record inspection, no free text, no employee endpoint, no consent/diagnosis/repair/verified resolution. Mock and actual concurrent MySQL regression included. Expanded encrypted isolated restore rehearsal preserves incident and intake uniqueness. Setup reference verifies short-lived (max 120s) Ed25519 display handoff evidence, independently pinned digest/key, installation/release/current checkpoint/challenge/session binding, canonical bytes and trusted clock; rechecks anchored journal before redacted display projection. No browser login, session authentication, challenge consumption, execution or setup mutation. Fresh combined CI required.

Conservative scope: M4 persists only minimal categorical internal technician intake and escalation, not employee/proactive workflows or attempt records. DEC-005 owner approval, retention/privacy and authenticated adapter remain required before exposure. Installation ID is supplied by trusted internal adapter, not proven by store. M2 remains a reference; independent signer/clock/challenge custody, one-use session handoff and runtime/Windows ACL adapter are pending. No live credential activation, main merge, production signing or acceptance.
