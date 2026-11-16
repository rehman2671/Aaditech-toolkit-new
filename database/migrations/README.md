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
