# Phase N Stage 10 — Production release and recovery integrity

**Status:** Implementation/code-level CI gates, NOT a production acceptance
certificate. No production MSI has been signed/published, no Hostinger
credentials are known and no customer Windows PC was touched.

## Confirmed Stage 9 baseline

GitHub Actions full four-job CI run
https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43885574743
completed successfully, including disposable MySQL tests and Windows MSI
build. No trusted signed release artifact was uploaded in routine CI.

## Code-signing workflow and approval boundary

A regular push to main MUST build an unsigned diagnostic MSI and MUST NOT
receive CODESIGN_PFX_B64, CODESIGN_PFX_PASSWORD or
CODESIGN_APPROVED_THUMBPRINT in its signing steps. Defense-in-depth
Release-Sign.ps1 rejects attempts to sign unless GITHUB_ACTIONS=true,
GITHUB_EVENT_NAME=workflow_dispatch and GITHUB_REF=refs/heads/main.
Negative-path tests verify this behavior on Windows CI.

The manual CI agent-build job selects the production-installer environment
instead of the push-only ci-diagnostic environment. Before use, the repository
administrator MUST:

1. Create or configure the GitHub Actions environment named
   production-installer; require human reviewers and restrict deployments
   to the main branch. A workflow cannot create or enforce reviewer policy
   by merely naming the environment.
2. Place CODESIGN_PFX_B64, CODESIGN_PFX_PASSWORD and
   CODESIGN_APPROVED_THUMBPRINT only in protected environment secrets.
   Remove any repository/org-wide copies accessible to other workflows.
   The PFX must be an approved, publicly trusted code-signing identity.
3. Trigger the existing CI workflow manually from main, approve the
   protected environment, and verify all jobs finish SUCCESS with a real
   uploaded it-toolkit-agent artifact. A normal push run is not eligible.
4. Independently check the EXE and MSI publisher signatures, full
   Authenticode trust, RFC3161 timestamps, embedded EXE equivalence,
   generic unprovisioned config, and SHA256SUMS.txt.
5. Manually run publish-signed-installer.yml on main with its successful
   manual CI source run ID, exact agent version/revision tag, and
   PUBLISH_SIGNED_AGENT confirmation. That workflow accepts only a
   successful same-repo main workflow_dispatch CI as its source and
   refuses existing release tags.
6. Approve the protected environment again for publication. Only after
   signature review set APPROVED_MSI_SHA256 in private Enterprise/.env
   and restart API under approved change control; without the pin,
   production download routes deny installer delivery.

No signing key or certificate has been created, supplied or fabricated.
No release was published as part of Stage 10.

## MySQL backup/restore integrity

- Enterprise/deploy/backup.sh uses a private temporary dump and emits a
  checksum sidecar named after the published SQL file with SHA-256 digest,
  both mode 600. Keep BOTH files in encrypted off-host storage.
- Enterprise/deploy/restore.sh requires a valid matching digest before
  touching Docker or dropping the database. A sidecar with wrong checksum
  or filename is always rejected.
- To restore a trusted PRE-Stage-10 dump with no hash, explicitly pass
  --yes --allow-legacy-without-sha256 after independent operator review.
  An invalid present sidecar cannot be bypassed using that flag.
- Enterprise/tests/Test-MySQL-Backup-Restore.sh exercises corruption,
  missing manifest and early refusal; the separate disposable Docker/MySQL
  rehearsal verifies real recovery and safety-backup behavior.

SHA-256 sidecars detect corruption, NOT authenticity against an attacker
who controls both files. Validate backup provenance, encrypt storage and
rehearse restore in a separate environment. The repository tests do not
replace real off-host backup/restore verification or production migration.

## Live Hostinger and Windows release requirements

Operator-owned evidence must still show VPS/DNS ownership, public HTTPS
with CA trust, restore of an encrypted off-host backup, full tenant
migration preflight with a reviewed change window, a two-node outage and
enrollment rehearsal, and successful signed MSI install/UAC/setup/
upgrade on a representative managed Windows machine.

Use deploy/verify-hostinger-acceptance.sh --host REAL_FQDN for the
read-only HTTPS/MySQL smoke check. This is necessary but not sufficient.

**Production release decision: BLOCKED** until trusted signing,
protected environment review, signed artifact publication, real
infrastructure recovery, migration and Windows acceptance are verified.
