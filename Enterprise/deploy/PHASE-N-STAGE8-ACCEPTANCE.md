# Phase N Stage 8 — Controlled production-readiness gates

**State: CI code and rehearsal gates implemented; NOT production certified.**

## Network / MySQL fail-closed acceptance

The isolated test-network-db-fault-injection.js starts real Node production-mode
workers over a loopback TCP proxy to disposable GitHub Actions MySQL 8. It
severs active DB sockets, rejects reconnects, checks that /healthz and
enrollment return HTTP 503 without in-memory fallback, verifies a cold worker
cannot start during DB loss, restores the proxy and confirms the same worker
recovers, redeems one unused bootstrap and rejects its replay. Only synthetic
tenant/device records are created and cleaned up. The test refuses to run
outside a dedicated test environment. API readiness now probes MySQL directly,
rather than trusting the last periodic health-check result. Production
never tries to start a local MariaDB init script as recovery.

This test does not simulate a real Hostinger VPS, TLS routing, external
load balancer, or regional MySQL network failure. Record the passing full CI
run and separately verify actual infrastructure behavior.

## Tenant identity migration safety

Current policy is ONE global owner for every hostname and device UID across
all tenants. Historical devices indexes are non-unique. No automatic
reassignment/merge of old rows and no tenant-scoped reuse is approved.

Use: node scripts/device-identity-preflight.js --audit
The read-only script reports only counts: null/blank tenant or identity,
unnormalized strings, case-insensitive hostname/UID collision groups, shared
host/UID across tenants, and devices with missing tenant references. It exits
with 2 if any fail; never prints actual hostnames or secrets. The
--require-indexes option also verifies the two planned global unique indexes.
CI --ci-fixtures checks collision detection in a TEMPORARY table on real MySQL.

Optional manual SQL: migrations/2026-11-global-identity-unique.sql.
Only after a clean audit, encrypted backup, verified restore, ALL API writers
quiesced, and staging rehearsal, apply both unique indexes in one MySQL
atomic DDL statement. Run --require-indexes and cross-tenant adversarial
enrollment tests afterwards. This is an operator change, NOT an auto migration.
MySQL DDL implicitly commits; prepare rollback via backup. Legacy ambiguous
records must be reviewed individually, not auto-deleted or transferred.

## Signed MSI and Hostinger

A green MSI build is not proof of a trusted publisher signature. Release
requires an approved certificate, verified Authenticode signatures on EXE and
MSI, timestamping, a SHA-256 manifest and a verified Windows-client install.
No PFX, trust or fingerprint confirmation means no released installer.

Hostinger needs a Docker-capable VPS (not shared hosting), approved real DNS,
ports 80/443, Caddy public TLS, API/MySQL health, backup/restore acceptance,
external-network outage/failback, device enrollment and remote-command checks.
Dry-run CI is not a live Hostinger acceptance. Never store production
credentials, identity collision details or signing private keys in Git.

**Release decision remains BLOCKED** until the above external evidence,
production identity audit/migration approval and customer Windows acceptance.
