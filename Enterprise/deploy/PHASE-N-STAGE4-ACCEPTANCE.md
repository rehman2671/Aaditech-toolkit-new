# Phase N Stage 4 — Production acceptance and residual blockers

Status: **NOT PRODUCTION CERTIFIED** (15 November 2026).
This page is an operator release gate, not evidence that Hostinger or a
physical Windows machine has been deployed.

## Verified in GitHub Actions

- Docker deployment-safety regression **passed** on main:
  https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43731718046
  The workflow includes a disposable MySQL 8 backup/mutate/restore
  data-integrity rehearsal, and offline destructive-restore safeguards.
- Node.js Vitest, PowerShell validation and API/MySQL integration jobs have
  passed on newer commits. Each complete release candidate still requires
  a green **full** CI workflow, including the Windows EXE and MSI job.
- Reconfiguration wizard failure in `File.Replace` was fixed using a real
  backup path. An unsupported `ps2exe -runtime40` option was removed.
- `project-index.json`, `project-state.json` and `project-progress.json`
  are maintained by the GitHub Actions metadata workflow. The historical
  audit's 100% completed-issue score does **not** mean production ready.

## Stage 4 identity hardening

- Enrollment accepts POST only; no GET fallback for bootstrap secrets.
- Registration and enrollment reject ambiguous/cross-tenant hostname/UID
  records *before* consuming one-use tokens.
- Both identity mutation paths use MySQL advisory locks on normalized hostname
  and UID. A per-process admission queue prevents exhausting the pool with
  concurrent lock holders. Production DB_POOL_SIZE must be >= 2.
- Lock timeouts fail closed with HTTP 503; two competing requests must not
  both claim the same device. Real multi-instance load/stress testing remains
  mandatory before treating the locking model as fully accepted.
- Legacy pre-enrollment fleet-token impersonation is disabled in production.

## Critical outstanding command-execution security blocker

The shipped MSI compiles `Agent-Collect.ps1`. The current worker's remote
command loops invoke `Invoke-RemoteCommand` without verifying
`signed_content` and `signature`. Separately, the current server includes
the **fleet-wide** `COMMAND_SIGNING_KEY` in enrollment/registration responses.
This design must be replaced by per-device signing credentials with verified
binding to command ID, device, tenant, payload and freshness **before enabling
remote-command execution in production**. Do not treat TLS alone as an
adequate command-authorization boundary. This is an explicit release blocker.

The existing Node backend uses HTTPS with per-device tokens; full mTLS
certificate issuance/enforcement is not yet implemented. Do not claim mTLS.

## Physical Windows MSI acceptance

On an isolated Windows 10/11 (and supported Windows Server) test machine:

1. Build and code-sign a generic MSI in a successful GitHub Actions run.
2. Confirm MSI Authenticode signature and publisher trust; reject unsigned
   production packages.
3. Perform an actual MSI installation and upgrade. Confirm Start Menu →
   IT-Toolkit → Configure Agent Server launches and requests UAC.
4. Configure a real HTTPS origin and tenant-issued one-use enrollment token.
   Verify TLS trust and database health; ensure no embedded token or hostname
   exists in the published MSI.
5. Confirm ProgramData token ACLs, scheduled tasks, SQLite outbox, first
   telemetry and subsequent server reconfiguration.
6. Attempt cross-tenant hostname/UID collisions and concurrent enrollment;
   confirm rejection without consuming a legitimate one-use token.

**Do not** send a production device fleet to the server before these checks.

## Hostinger / real-server acceptance (operator controlled)

This Compose deployment requires a Docker-capable VPS with DNS pointing to
it, TCP 80/443 available, and a trusted Caddy ACME HTTPS certificate.
Shared hosting without Docker/required inbound ports is not supported.

```bash
cd Enterprise/deploy
bash deploy-mysql.sh --host YOUR-ACTUAL-DNS-NAME --dry-run
# Real deployment only after preparing an approved VPS:
bash deploy-mysql.sh --host YOUR-ACTUAL-DNS-NAME
```

Confirm `/healthz` reports `components.database = HEALTHY`, then
perform a migration rehearsal and an encrypted, access-controlled off-host
backup. In a separate disposable/preproduction Docker project, exercise
`Enterprise/tests/Test-MySQL-Live-Rehearsal.sh` and restore the snapshot.
Never execute destructive restore testing against the live data volume.

Final release requires operator sign-off on Windows installer, signed
artifact, tenant isolation, real VPS HTTPS, backup/restore and remote
command security. All blockers must be closed and tested first.
