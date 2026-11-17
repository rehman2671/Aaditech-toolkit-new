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
