# Phase N Stage 9 — Release integrity and multi-node fault acceptance

**Status: Code-level gates implemented, NOT production certified.**
All destructive DDL simulations target disposable GitHub CI MySQL.

## Verified Stage 8 baseline

All four GitHub Actions CI jobs passed in run
https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43878381755.
These included PowerShell, Node/Vitest/MySQL, API/MySQL and real Windows MSI
build. That run uploaded no trusted signed installer artifact, so this is
not a signed release.

## New Stage 9 CI gates

1. **Real unique-index migration rehearsal**
   test-device-identity-index-migration.js runs the exact reviewed ALTER TABLE
   statement from migrations/2026-11-global-identity-unique.sql on a unique
   isolated copy of the devices schema, NEVER on real devices. It verifies:
   case-insensitive legacy duplicates cause migration failure without
   partial indexes; clean rows allow both unique keys; the database then
   blocks duplicate cross-tenant hostnames/UIDs regardless of letter case
   but allows distinct devices. The scratch table is dropped in finally.
2. **Two-node MySQL network partition**
   test-network-db-fault-injection.js now starts two production-configured
   independent API processes sharing the same CI MySQL TCP fault proxy.
   Both must report healthz 503 and enrollment 503 during partition, and a
   new process must refuse to boot without MySQL. Both recover, and a token
   redeemed on one replica must be rejected on the other as a replay.
3. **Signer negative-path tests**
   Enterprise/tests/Test-ReleaseSigningGates.ps1 intentionally clears
   signing variables (restoring them in finally) and confirms missing
   credentials disable publication, partial credentials fail and malformed
   approved publisher thumbprints fail. The real signed path still needs
   an operator-owned publicly trusted certificate.

These tests are scheduled in CI; only a completed successful Stage 9 CI
run counts as acceptance. CI cannot prove actual VPS/Windows behavior.

## Operator-controlled production identity migration

- Quiesce ALL server replicas and writers handling device enrollment,
  registration and identity repair.
- Take an encrypted, access-controlled MySQL backup and prove it restores
  on an isolated MySQL 8 instance. Record operator/change approval privately.
- Run: node scripts/device-identity-preflight.js --audit
  Any orphan tenant, missing UID, blank hostname, whitespace, global
  hostname collision or UID collision BLOCKS the migration. An operator must
  review anomalies; never auto-merge/reassign ownership.
- Apply Enterprise/deploy/migrations/2026-11-global-identity-unique.sql
  on a restored staging copy first. Rehearse cross-tenant enrollment,
  token rotation/revocation and outage recovery.
- In an approved maintenance window only, run the manual SQL against
  production while enrollment remains stopped; MySQL DDL commits implicitly.
- Re-run: node scripts/device-identity-preflight.js --require-indexes
  Confirm schema, audit, backups and application health before reopening
  registration. Use the approved restore/rollback plan if checks fail.

No Hostinger/production database migration has been executed.

## Installer publication and distribution

Windows CI signs the executable BEFORE WiX packages the MSI. The extracted
MSI payload must match the signed EXE byte-for-byte; the MSI itself must
also be timestamped and publicly trusted. An SHA256SUMS.txt digest manifest
binds both. Only approved trusted certificates/fingerprints may publish.

The manual publish-signed-installer.yml workflow additionally requires
an approved same-repository successful CI run with an uploaded signed MSI,
the exact agent version/revision tag, an explicit confirmation and a
production-installer GitHub environment protected by required reviewers.
Verify-ReleaseArtifact.ps1 revalidates signatures and exact payload bytes
before release. No certificate or signed artifact means no release.

After independent acceptance, place APPROVED_MSI_SHA256 in the private
Enterprise/.env and perform controlled API restart. With that field absent
or mismatched, production will refuse MSI downloads. The SHA-256 digest
is a byte pin, NOT a substitute for independent Authenticode trust checks.

## Hostinger release gates

The supported target is a Docker-capable VPS with real DNS, public Caddy TLS,
ports 80/443, durable MySQL 8 and encrypted off-host backup. Run the
read-only verify-hostinger-acceptance.sh with the actual FQDN. This checks
HTTPS, redirect and MySQL readiness but does NOT prove site ownership,
full backup/restore, external network partition, tenant isolation or
physical Windows install/upgrade. Those require operator-controlled
infrastructure access and sanitized evidence.

**Release decision remains BLOCKED** pending trusted signed release,
approved production identity migration, real Hostinger recovery acceptance,
and customer Windows GUI/UAC/MSI enrollment tests.
