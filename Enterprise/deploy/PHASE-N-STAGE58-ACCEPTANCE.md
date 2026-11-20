# Phase N Stage 58 — Same reviewer-signed approval from CI signing to public release

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; FRESH MAIN DIAGNOSTIC EXE/MSI 4/4 + SAFETY 2/2 SUCCESS; PROTECTED SIGNING/PUBLIC RELEASE PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Security finding

The N56 Windows CI release-signing pipeline requires an independently
reviewer-signed short-lived RSA-SHA256 manifest binding exact Git SHA,
agent version/MSI revision, publisher certificate and vetted SQLite
ZIP/executable digests. N55 subsequently validates signed EXE/MSI bytes and
their final embedded contents before uploading a CI artifact.

However, the **separate** manually dispatched
`.github/workflows/publish-signed-installer.yml` previously verified a
successful manual CI source run, approved MSI hash, trusted publisher and
tag without re-verifying **the exact N56 approval identity originally used
to sign that CI artifact**. A different reviewer record that was otherwise
valid for the same SHA and dependency pins was not tied to the signing
run's original authorization. The release workflow also did not
independently pin the exact embedded `sqlite3.exe` file.

No actual customer signed installer release or compromise was observed.
This is a code-level gap at the separate GitHub Release publication boundary.

## Implementation

- `Enterprise/agent/build/Write-SourceReleaseApprovalReceipt.ps1` runs
  **only after** protected manually dispatched `main` N55 signed-payload
  validation returned `PUBLICATION_VERIFIED=true`. It reauthenticates
  the N56 reviewer RSA-signed record against the *original* PrePackage
  approval SHA, then writes precisely **64 uppercase SHA-256 hex characters
  plus one LF** to `RELEASE-APPROVAL-SHA256.txt` and sets
  `RELEASE_APPROVAL_RECEIPT_VERIFIED=true`. No private reviewer signing
  key is loaded or generated.
- `.github/workflows/ci.yml` requires the source signing flag, final
  publication verification and this **approval receipt success** before
  uploading the manual `it-toolkit-agent` CI artifact. The artifact
  contains the EXE, versioned MSI, SHA256SUMS, blank first-run setup
  template and the **non-secret source approval identity**. PR and
  automatic push diagnostic builds remain non-publishable and omit the
  receipt.
- `Enterprise/agent/build/ReleasePublicationApproval.psm1` checks
  **exactly five** ordinary release source files, the N55 canonical
  two-line SHA256SUMS with independently recomputed EXE/MSI bytes, one
  expected versioned MSI, empty first-run endpoint/tokens and the exact
  65-byte approval receipt. It reauthenticates the short-lived N56 RSA
  signature, independently pinned reviewer public X.509 DER certificate
  SHA, exact source Git SHA, version/MSI revision, exact approved publisher,
  exact SQLite ZIP/EXE pins and **same initial approval digest**.
  Rotating to a second validly signed reviewer record after CI signing
  is not sufficient to publish.
- `Enterprise/agent/build/Assert-PublicationReviewerApproval.ps1`
  requires a protected manual `workflow_dispatch` on `main`, exact
  human-approved successful source run SHA from `SOURCE_SHA`, and
  **the actual SHA-pinned source checkout**. It deliberately does not
  compare against `GITHUB_SHA`, which belongs to the *separate*
  publication workflow run and may differ from the independently approved
  signing source commit.
- `publish-signed-installer.yml` requires exact reviewed source CI
  workflow provenance, then checks the same signed reviewer record and
  downloaded identity **twice**: once immediately after artifact download
  and again directly before the irreversible `gh release create`
  action. It repeats EXE/MSI publisher and payload verification before
  creation. Tag must match the source agent version and MSI revision.
- `Enterprise/agent/build/Verify-ReleaseArtifact.ps1` now also applies
  strict canonical N55 SHA256SUMS validation, the independent N54-pinned
  **embedded** `sqlite3.exe` hash, exactly one embedded signed EXE
  matching the release EXE, and unprovisioned embedded `agent.json`
  checks, in addition to existing real Windows Authenticode chain, exact
  publisher thumbprint and valid timestamp.

Only three public GitHub Release binary/checksum assets are submitted:
signed EXE, signed MSI, and SHA256SUMS.txt. The source approval receipt is
**not a public release asset**. It is evidence, not a replacement for a
reviewer signature, and is never accepted without cryptographically
verifying the exact underlying N56 approval.

## Offline Windows acceptance tests

`Enterprise/tests/Test-Stage58ReleasePublicationApproval.ps1` executes
on real Windows PowerShell **5.1 and 7** with disposable synthetic EXE,
MSI, checksum manifest and an ephemeral RSA-2048 certificate. It verifies:

1. Correct signed N56 scope plus matching source receipt accepted.
2. A **different, validly RSA-signed** approval ID for the same source
   rejected because its digest differs from original receipt.
3. Changed source Git SHA, version, revision, release tag, publisher,
   SQLite archive/executable pin or reviewer public certificate pin
   rejected.
4. Truncated, lowercase, mismatched or extra-newline receipt, duplicated
   SHA256SUMS, changed binary bytes, unexpected extra artifact or
   provisioned server configuration rejected.
5. Static exact order of protected source receipt, artifact download,
   repeated reviewer approval validation, signed payload checks and
   `gh release create`. No new test key enters source assets, repo
   secrets, customer environment or release publication.

## Acceptance and remaining owner actions

- [x] PR N58 PowerShell 5.1/7 tests, earlier security gates,
  Node/Vitest+MySQL and API/MySQL **3/3 SUCCESS**, MySQL safety **2/2 SUCCESS**.
- [x] Reviewed [PR #53](https://github.com/rehman2671/Aaditech-toolkit-new/pull/53)
  merged at `c07a0560d573ca3095d91f7ccc363122049fd5e7`. New `main`
  diagnostic Windows EXE/MSI build, extraction, installed setup/clean
  uninstall and tenant-preserving major upgrade **4/4 SUCCESS** and
  deployment safety **2/2 SUCCESS** independently verified.
- [ ] Independently approved publisher key/certificate, reviewed
  SQLite ZIP/EXE digests, real reviewer-signed per-source manifest,
  protected manual main signing source run with N58 receipt, and a real
  protected GitHub Release with pinned MSI digest **PENDING**.
- [ ] Actual customer Hostinger DNS/TLS, physical Windows devices,
  live tenant/ACK-loss/MySQL receipts, encrypted offsite restore and
  authorized security sign-off **PENDING**.

**Production NOT APPROVED.** This stage must not auto-issue reviewer keys,
use test-generated signatures for production, claim a successful manual
signing run, or publish unsigned diagnostic installers.

See [production release checklist](PHASE-N-PRODUCTION-RELEASE-CHECKLIST.md)
and [security issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Previously verified baseline

- [N57 fresh main Windows CI 44743528930](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44743528930):
  diagnostic EXE/MSI lifecycle **4/4 SUCCESS**.
- [N57 fresh main deployment safety 44743529039](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44743529039):
  **2/2 SUCCESS**.
- [N57 project index maintenance 44744480722](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44744480722):
  safe metadata refresh accepted; these results were **pre-N58** and
  did not execute a signed production publication.

## Verified N58 GitHub acceptance evidence

- [PR #53](https://github.com/rehman2671/Aaditech-toolkit-new/pull/53)
  reviewer-checked head `822ed227e32d6826746ab8f3ff9736aea375e65b`,
  merge `c07a0560d573ca3095d91f7ccc363122049fd5e7`.
- [PR CI 44748295565](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748295565):
  **3/3 SUCCESS** — Windows PowerShell 5.1/7, new N58 synthetic
  reviewer-signature receipt/rotation/altered-source negative paths,
  N31 protected MSI hash pin regression, prior security checks,
  Node/Vitest+MySQL and API/MySQL. MSI job **SKIPPED** on PR.
- [PR deployment safety 44748295510](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748295510):
  **2/2 SUCCESS** — offline deployment and isolated real MySQL
  backup/restore verification.
- Fresh post-merge [`main` CI 44748922171](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748922171):
  **4/4 SUCCESS** — all PowerShell tests, Node/Vitest+MySQL, API/MySQL,
  real Windows EXE+WiX MSI build, MSI administrative extraction,
  installed first-run setup/clean uninstall, and major upgrade preserving
  tenant configuration.
- Fresh [`main` safety 44748922199](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748922199):
  **2/2 SUCCESS**. [Main index maintenance 44748922258](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748922258):
  **SUCCESS**.
- The automatic `push` diagnostic MSI job reported **N58 record final
  verified source reviewer approval identity SKIPPED** and **Upload
  verified signed artifacts only SKIPPED**, which is the intended
  non-publishable behavior. No real protected N56 reviewer-signed CI
  source run, publisher HSM signing or GitHub Release creation was
  executed. **Customer production NOT APPROVED.**

## Release-owner execution handoff — NOT PERFORMED

After a separate human security/release reviewer has independently
confirmed the exact main source SHA, version, MSI revision, publisher
certificate thumbprint, SQLite archive hash and sqlite3.exe hash, and
has signed the canonical short-lived N56 manifest with a privately held
RSA key, use this two-stage production flow:

1. Authorize protected manual `CI` `workflow_dispatch` on the exact
   reviewed `main` source. The protected `production-installer`
   environment must contain the vetted publisher signing credentials,
   approved SQLite fingerprints, signed reviewer manifest, signature,
   public DER and independently reviewed DER SHA256 fingerprint. The
   source job must pass N54–N56 signing/payload verification, N55 final
   artifact check and N58 original approval receipt stage. Observe
   `it-toolkit-agent` artifact upload; an ordinary `push` diagnostic
   run is **not** an accepted signing source.
2. Independently review the successful source **run ID**, the **exact
   40-hex source SHA** and the **64-hex signed MSI SHA256** without
   deriving the approval directly from a just-downloaded artifact.
   Then explicitly authorize `Publish approved signed Windows installer`
   from `main` with `source_run_id`, `approved_source_sha`,
   `approved_msi_sha256`, source version/revision `release_tag`, and
   exact `PUBLISH_SIGNED_AGENT` confirmation. The same original
   N56 reviewer record must still be valid within its 24-hour window.
   Review the result; N58 will prevent publication on any identity or
   checksum mismatch.

**Neither protected step was executed as part of this stage.** The
GitHub runner evidence above is diagnostic only. Human approval,
customer Hostinger, physical Windows and separate MySQL receipts are
independent outstanding production gates.
