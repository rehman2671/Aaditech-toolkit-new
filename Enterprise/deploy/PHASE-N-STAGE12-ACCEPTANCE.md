# Phase N Stage 12 — Live-user authorization and legacy token migration

**Scope:** production user JWT verification, tenant-owned device endpoints, and recovery-backed removal of historical plaintext bootstrap credentials.

**Production acceptance:** BLOCKED until independently verified signed release, real Hostinger VPS/DNS/TLS deployment, restore rehearsal and physical managed Windows tests. A green diagnostic CI build is not a signed public release.

## Production JWT and workspace isolation

- auth-principal.js requires an ACTIVE, enabled persistent MySQL user with the same immutable user ID, username, tenant ID and current normalized role as the JWT in NODE_ENV=production. Deleted/disabled/suspended accounts and changed privileges force a new sign-in rather than retaining stale role/tenant claims.
- The universal user-token middleware, telemetry user-token alternative and downloadable bootstrap generation all use the current identity policy. Expired, revoked and jti-revoked tokens do not receive bootstrap enrollment credentials.
- Both regular and SUPER_ADMIN users are confined to their authenticated tenant when listing, reading or deleting devices. A client-supplied tenant_id does not grant access to another tenant. This does not replace a future formally authorized workspace-membership selection feature.
- Detailed device responses remove bearer credentials, token hashes/prefixes, secrets and private-key material. Neither agent identities nor private credentials should be exposed to portal consumers.

## Cross-tenant inventory, commands and reporting

- User listing requires tenant SUPER_ADMIN and uses a tenant-filtered SQL query; user creation uses the authenticated tenant and one of its registered companies, rather than a hardcoded default. Targeted user updates deny records outside the actor tenant.
- Company inventory and creation are constrained to the actor tenant. A tenant admin cannot select another tenant by modifying a query parameter.
- Bootstrap portal data is limited to the actor's companies/current account, and production public origin display does not trust the incoming Host header.
- Legacy events have no tenant_id column. The portal now joins event rows with their uniquely identified devices in SQL and constrains events/device reports by the current tenant. No cross-tenant report fallback is allowed for missing identifiers.
- Alert listing and dashboard counts are tenant-filtered. The command_queue table also lacks tenant_id, so command inventory joins owning devices in MySQL and never treats missing tenant_id fields as public. Remote-command dispatch rejects targets outside the actor tenant even for SUPER_ADMIN.
- Explicit platform-wide administrative membership and truly authorized workspace switching still require a separate implementation; a user-selected tenant ID alone is never proof of authorization. The existing global default-company/branding configuration needs a tenant-aware design review before multi-tenant production acceptance.

## One-time historical plaintext cleanup (operator action)

New records already store only hashes. Old MySQL installations may still contain plaintext values in BOTH msi_packages.bootstrap_token and used_bootstrap_tokens.token.

On the configured Docker-capable deployment host:

1. Review the current backup/restore plan and maintenance window. Stage 12 never performs a real production change automatically.
2. Audit counts without token contents using:
   bash Enterprise/deploy/migrate-legacy-msi-bootstrap.sh --audit
3. Review reported hash mismatches or whitespace anomalies before proceeding; any such anomaly blocks automatic cleanup. Coordinate with active enrollment operations.
4. After operator approval:
   bash Enterprise/deploy/migrate-legacy-msi-bootstrap.sh --apply --confirm HASH_ONLY
5. This action first runs a fresh MySQL dump, checks its SHA-256 sidecar and backup header/completion marker, then transactionally fills missing matching SHA-256 hashes and NULLs plaintext in MSI and redeemed-token tables. It fails closed on missing backup, checksum mismatch or hash conflicts.
6. Run --audit again, store the backup encrypted off-host and perform a disposable restoration rehearsal. The utility does not rotate active per-device authentication credentials or automatically revoke unexpired bootstrap tokens; separate invalidation policy remains operator-owned.

**Sensitive-data note:** Historic dumps can still contain the old plaintext enrollment credentials; protect and retire those dumps using an approved backup retention procedure. SHA-256 integrity sidecars do not prove authenticity if an attacker can alter both files.

## CI and tests

- tests/unit/auth-principal.test.js: production deleted/disabled/stale JWT claims rejected.
- tests/unit/device-visibility.test.js: same-tenant device binding and agent-secret redaction.
- Enterprise/tests/Test-LegacyMsiMigration.sh: invalid apply flags rejected before touching a database.
- Enterprise/tests/Test-LegacyMsiMigration-Live.sh: CI-only disposable MySQL fixture verifies audit, hash-conflict refusal, verified backup and removal of plaintext while preserving hashes.
- .github/workflows/deployment-safety.yml runs the offline and real MySQL validation plus existing restore rehearsal.

Deployment-safety regression https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43919034394 completed SUCCESS in both offline and real disposable MySQL 8 backup/migration jobs, including mismatch refusal and SHA256-backed cleanup.

Full Phase N12 CI https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43920480028 verified SUCCESS for Node/Vitest, PowerShell and real MySQL/API tests; its Windows EXE/MSI job was still in progress at the time of this update. Confirm its final conclusion before declaring all four gates green.

**Production remains BLOCKED** even if all CI gates pass: protected GitHub signing/release approval, genuine Hostinger VPS/DNS/TLS, a live recovery rehearsal, authorized workspace selection and physical Windows acceptance are not yet verified.
