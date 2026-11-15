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

## Command-execution signature hardening (implemented; physical rollout pending)

The canonical MSI worker, `Agent-Collect.ps1`, now rejects unsigned or
tampered commands in **both** normal and privileged command loops.
`command-signing.js` signs a versioned JSON envelope with the **unique
enrolled device credential** (HMAC-SHA256) and binds command ID, device ID,
tenant ID, hostname, executable kind/payload and a maximum five-minute TTL.
The Windows worker loads an ACL-protected local enrollment identity and
verifies the signature, tenant, device, hostname and freshness **before**
using the signed executable fields. Server enrollment/registration no
longer discloses the fleet-wide `COMMAND_SIGNING_KEY`. Changes to the
server address remove previous local token and tenant identity together.

Node.js and Windows command-signature regression suites cover tampering,
wrong-device and wrong-tenant targeting, replay-window expiry and missing
identity. A full physical Windows MSI installation/upgrade and successful
signed-command end-to-end acceptance remain **mandatory**; older agents
without this verification must be upgraded or command execution disabled
until replaced. TLS alone remains insufficient to authorize commands.

**MSI publication policy:** CI builds a generic agent executable and installer
for diagnostics. Published release artifacts are now gated on the presence of
`CODESIGN_PFX_B64` and successful Authenticode chain verification by
`signtool`. If signing credentials are absent, the code-build job can pass
but the MSI is **not uploaded as a deployable artifact**. A passing build
is therefore not proof of a signed installer; verify the upload and
certificate on a real Windows machine.

**Post-enrollment command result authorization:** the command result API
requires an enrolled `X-Device-Token` that resolves to the **exact command
device ID**. Operator JWTs, URL query-string credentials and tokens for
another workspace's device cannot report execution of that command. The
universal gateway returns HTTP 401 for unauthenticated URL-only secrets,
while the agent endpoint returns HTTP 403 for missing/wrong device credentials.

**Legacy fleet HMAC hard stop:** production now rejects requests authenticated
solely using the fleet-wide `X-Agent-Signature` / `X-Device-UID` /
`X-Timestamp` headers instead of auto-provisioning a device into the default
tenant. The old HMAC mechanism is retained solely for isolated
`NODE_ENV=test` fixtures. All real agents must use per-device enrollment
tokens; this intentionally breaks legacy fleets until re-enrolled.

The server still requires `COMMAND_SIGNING_KEY` for legacy configuration
compatibility and must never distribute it. Its complete removal/rotation
and old-agent migration remain release-acceptance tasks.

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

**Production database configuration (fail closed):** supply explicit
`DB_HOST`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` to the Node API.
Production connections reject missing/blank settings instead of relying on
development defaults. `DB_PORT` must be in the valid TCP range, and
`DB_POOL_SIZE` must be between 2 and 500 to reserve capacity for identity
advisory locks and their protected database operations. A validation failure
does not permanently latch the connection retry state. **Production Node
startup does not bind its HTTP port until MySQL is healthy; a missing database
credential or exhausted startup retries terminates the process.** After a
runtime database outage, production API routes fail closed with HTTP 503
rather than mutating in-memory tenant state. `/healthz` also reports 503 and
`components.database=DEGRADED` during the outage. The supplied Docker
Compose configuration passes the database values through from the host's
approved `Enterprise/.env`. Never put that file in Git or the MSI.

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
