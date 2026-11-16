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

**Production server distribution guard:** The Node backend will NOT offer or stream an MSI in production unless `APPROVED_MSI_SHA256` matches that MSI's complete SHA-256 bytes and the file is larger than a synthetic placeholder. Set this only after independently verifying both Authenticode signatures, approved publisher trust and the CI manifest. The Compose API reads this value from operator-owned `Enterprise/.env`; blank disables MSI downloads. A SHA-256 pin ensures byte identity but does not itself prove publisher trust. Rotate the pin for a new approved release; do not bake it into the Windows agent.

**Release decision remains BLOCKED** until the above external evidence,
production identity audit/migration approval and customer Windows acceptance.

**Signing implementation:** GitHub workflow now requires CODESIGN_PFX_B64, CODESIGN_PFX_PASSWORD and CODESIGN_APPROVED_THUMBPRINT. It signs EXE before MSI packaging, checks extracted MSI payload hash, verifies the OS-trusted chain/approved publisher fingerprint and RFC3161 timestamp on both EXE and MSI, then adds SHA256SUMS.txt. No credentials means no upload. The signing root is never imported into CI, so an untrusted internal CA cannot masquerade as public trust.

## Read-only Hostinger public HTTPS smoke gate

On the approved Docker-capable VPS or an independent operator host, run:

  bash Enterprise/deploy/verify-hostinger-acceptance.sh --host YOUR_REAL_DNS_HOST

This verifies public OS-trusted HTTPS, 200 /healthz with persistent MySQL HEALTHY and HTTP-to-HTTPS redirect. Its --dry-run validates inputs offline in CI. It never deploys, changes DNS or accepts secrets. A passing smoke test is ONLY a prerequisite for a live, operator-approved Hostinger readiness decision and is not proof of backups/tenant isolation/Windows enrollment.


## Manually approved signed GitHub Release (NOT run automatically)

The workflow .github/workflows/publish-signed-installer.yml is manual only.
An operator must first configure a publicly trusted code-signing certificate
as GitHub Actions secrets CODESIGN_PFX_B64, CODESIGN_PFX_PASSWORD and
CODESIGN_APPROVED_THUMBPRINT. Protect the production-installer GitHub
environment with required human reviewers and main-branch restrictions.

Once the full CI has passed AND it-toolkit-agent artifact has been uploaded,
run the manual workflow from main with the successful source CI run ID, exact
tag matching agent-v<semver>-r<msi_revision> from the source commit (currently
agent-v1.1.2-r1), and confirmation phrase PUBLISH_SIGNED_AGENT.

Publication refuses an unsuccessful/external CI run, missing signed artifacts,
untrusted or wrong publisher, missing timestamp, corrupt SHA-256 manifest,
preprovisioned client secrets, an unsigned/different EXE in the MSI, and an
existing tag. No release is created until every check succeeds. Do not claim
a signed release exists until the workflow really publishes one.

After independent verification of the release signature and manifest, the
operator must set APPROVED_MSI_SHA256 in private Enterprise/.env to the
approved MSI file digest and restart the production API. Production routes
refuse any MSI whose exact bytes do not match the approved digest (and
always reject tiny synthetic fixture packages). The digest pin alone is
not a substitute for trusted-publisher verification.

**Production identity lookup consistency:** Device ID, hostname and UID lookups now bypass process-local caches and demo/in-memory records in production; each lookup must reflect MySQL or fail closed. Test/development fixtures keep their prior fallback behavior. Per-device credential lookup had already been hardened in Stage 6.
