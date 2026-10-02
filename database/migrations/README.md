# Database Migrations Architecture

**Engine**: MySQL 8.0+ / MariaDB 10.4+ (Authoritative Single Database Engine)

This directory contains ordered, idempotent, versioned schema migrations managed by the enterprise migration runner in `db.js`.

## Migration Sequence

1. `001_init_schema.sql`: Core relational schema (tenants, companies, users, devices, process/patch inventories, command queue, packages, tickets, system settings).
2. `002_partitioning.sql`: Time-series telemetry table (`telemetry_history`) with MySQL-native range partitioning `PARTITION BY RANGE (TO_DAYS(recorded_at))` and composite primary key `(id, recorded_at)`.
3. `003_rbac_and_audit.sql`: RBAC, immutable audit logging (`audit_logs`), alerting engine (`alert_rules`, `alerts`), fleet device groups, telemetry policies, and idempotent bootstrap seed accounts.

## Migration Runner & Concurrency
- Tracked via the `schema_migrations` table (`version`, `name`, `applied_at`, `execution_time_ms`, `checksum`).
- Multi-instance concurrency protected via MySQL distributed application lock: `SELECT GET_LOCK('itk_schema_migrations_lock', 15)`.
- Applied exactly once, in deterministic numeric order.
- Partition maintenance (`maintainTelemetryPartitions`) automatically generates forward monthly partitions and prunes partitions beyond data retention policies.
