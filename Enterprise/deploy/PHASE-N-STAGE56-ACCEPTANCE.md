# Phase N Stage 56 — Independent reviewer-signed exact release authorization

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; FRESH MAIN DIAGNOSTIC EXE/MSI 4/4 + SAFETY 2/2 VERIFIED; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Security finding

An approved publisher PFX, a protected manual `workflow_dispatch` on
`main` and N54 approved SQLite fingerprints do not by themselves
cryptographically bind **which repository commit, agent semantic version,
MSI revision and dependency hashes a human reviewer authorized**. A
reviewed environment credential could be used for another source revision
before the next manual security review.

N56 introduces a separate, short-lived **RSA-SHA256 reviewer authorization
of the exact release scope**, in addition to existing operating-system
Authenticode and protected environment approval. This is a defense-in-depth
release *authorization*, not a claim that previous diagnostic builds
were production signed or public.

## Exact signed reviewer manifest

The reviewer signs the following exact canonical US-ASCII bytes, with **LF
newline only**, precisely these ten nonempty lines **plus a terminal LF**,
in this order:

```text
AADITECH-MSI-RELEASE-V1
git_sha=<40 lowercase hexadecimal digits>
agent_version=<exact major.minor.patch>
msi_revision=<1 through 999, no leading zero>
publisher_thumbprint=<40 UPPERCASE hexadecimal digits>
sqlite_archive_sha256=<64 UPPERCASE hexadecimal digits>
sqlite_exe_sha256=<64 UPPERCASE hexadecimal digits>
issued_utc=<yyyy-MM-ddTHH:mm:ssZ>
expires_utc=<yyyy-MM-ddTHH:mm:ssZ>
approval_id=<8-64 allowed ASCII characters>
```

Angle-bracket placeholders above describe required values and are **not**
actual approvals. Obtain `git_sha` from the exact `main` source commit,
version and positive MSI revision from
`Enterprise/agent/agent-version.json`, and the publisher certificate and
SQLite ZIP/executable hashes by independent release-owner inspection.
The manifest must be signed by the independent reviewer using **RSA PKCS#1
v1.5 SHA-256**; **do not copy the private reviewer key to GitHub, this repo,
an installer, or the target PC**.

A protected `production-installer` GitHub environment (manual human
approval and main-branch restriction remain mandatory) must supply:

- `RELEASE_APPROVAL_MANIFEST_B64`: base64 of the **exact manifest bytes**.
- `RELEASE_APPROVAL_SIGNATURE_B64`: base64 of the detached RSA-SHA256 signature.
- `RELEASE_APPROVAL_REVIEWER_DER_B64`: base64 of the reviewer **public X.509 DER** certificate only.
- `RELEASE_REVIEWER_CERT_SHA256_APPROVED`: independently pinned, reviewer-approved SHA-256 of the public certificate DER bytes.
- Previously required `CODESIGN_PFX_B64`, `CODESIGN_PFX_PASSWORD`,
  `CODESIGN_APPROVED_THUMBPRINT`, `SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED`
  and `SQLITE3_EXE_SHA256_APPROVED`, all separately authorized.

All values are deliberately **unset by code and this document**; do not
derive approved values from a just-downloaded artifact, source commit
automatically trusted by the agent, or test-generated key. An actual
signing run requires independent human key custody and release approval.

## Implementation

- `Enterprise/agent/build/ReviewedReleaseApproval.psm1` verifies a
  canonical signed manifest with no HTTP/filesystem dependencies, strict
  bounded base64/ASCII validation, SHA-256 pin of the approved reviewer
  public certificate, certificate validity, RSA-2048/4096 signature,
  exact scoped values, current UTC validity and maximum **24-hour** window.
  It compares all 32 SHA bytes to the initial authenticated record on
  subsequent checks; different, validly signed reviewer approval cannot
  silently take over a release in progress.
- `Enterprise/agent/build/Assert-ReleaseAuthorization.ps1` derives
  `GITHUB_SHA`, current metadata version/revision and independent publisher/
  SQLite pins from the protected release environment. It returns only the
  verified initial manifest SHA-256 or a redacted fail-closed decision.
- `Release-Sign.ps1` now authenticates the **initial reviewer record
  before loading the publisher PFX or invoking signtool** and exposes only
  its digest to the next job steps after successful EXE signing. The
  **Finalize** MSI signing step must reauthenticate the same record and
  verify that it remains unexpired.
- `Verify-SignedPublication.ps1` reauthenticates the **same** reviewer
  record both before and after N55 final signed artifact/SQLite inspection,
  immediately before authorizing protected upload.
- `.github/workflows/ci.yml` passes independently protected reviewer
  records to **only** the three manually dispatched production-signing/
  publication steps, not PR, automatic push, diagnostic MSI, Node/MySQL or
  general test stages. Existing unsigned push and PR behavior is unchanged.

Failures reveal neither exact keys, requested fingerprints, customer
server endpoints nor raw manifest contents. A changed source SHA, version,
MSI revision, publisher certificate, SQLite ZIP or sqlite3.exe hash,
signature, reviewer public-key fingerprint, approval identity or expiry
causes refusal. The checker cannot issue its own approval or sign a
public MSI.

## Offline Windows tests and acceptance

`Enterprise/tests/Test-Stage56ReviewedReleaseApproval.ps1` uses only a
throwaway RSA-2048 certificate and self-signed fixture on Windows PowerShell
5.1 and PowerShell 7. It proves:

1. Exact canonical signed scope and digest accepted.
2. Validly signed changed approval ID **rejected during same release**.
3. Separate validly signed wrong commit, agent version, MSI revision,
   publisher certificate or SQLite ZIP/EXE pin **rejected**.
4. Authentic expired approval, CRLF/noncanonical syntax, tampered
   signature, wrong reviewer public-DER hash and bad base64 **rejected**.
5. Signing cannot start before the reviewer gate; both signing stages and
   final preupload revalidation bind same original digest; protected secrets
   are supplied only to three intended manual signing/publication steps.

- [x] PR Windows PowerShell 5.1 and 7 N56 tests plus N31–N55 baseline,
  Node/Vitest+MySQL, API/MySQL and deployment safety successful.
- [x] Reviewed PR #51 merged at verified head into `main`.
- [x] Independently verified fresh `main` diagnostic EXE/MSI build,
  setup/uninstall/upgrade **4/4 SUCCESS** and safety **2/2 SUCCESS**.
- [ ] Independent reviewer public DER pin/key custody, real signed
  per-release manifest, production publisher/HSM signing, actual protected
  N56 signing flow and timestamped public MSI upload **PENDING**.
- [ ] Genuine Hostinger domain/DNS/TLS, physical Windows ACK-loss/tenant
  MySQL receipts, offsite restore and external human security approval
  **PENDING**.

**Production NOT APPROVED.** Security tracker: [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Verified previous diagnostic baseline

- [N55 main CI 44733652919](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733652919):
  **4/4 SUCCESS**, including real Windows EXE/MSI install, uninstall
  and major upgrade. Signed artifact upload and final publication step
  intentionally **SKIPPED** on automatic push.
- [N55 main safety 44733653033](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733653033):
  isolated MySQL restore and offline Bash recovery **2/2 SUCCESS**.
  Neither run authorized a customer release.

## Verified GitHub PR and merge evidence

- [PR #51](https://github.com/rehman2671/Aaditech-toolkit-new/pull/51)
  head `a1f5b0137f052911804d865516966bc497ac41c4` merged into main as
  `d5142ccc5d8088cbeac13b0828fe1d9bb616c832`.
- [PR CI 44737871203](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44737871203):
  **3/3 SUCCESS**: Windows PowerShell 5.1 + 7 reviewer-signed N56
  synthetic scope/rotation/replay tests plus baseline security regressions,
  Node/Vitest+MySQL and API/MySQL. PR diagnostic MSI job correctly **SKIPPED**.
- [PR safety 44737871073](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44737871073):
  offline Bash/database recovery and isolated real MySQL backup/restore
  **2/2 SUCCESS**.
- Fresh post-merge `main` [CI run 44738371422](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44738371422):
  **4/4 SUCCESS**, including Windows PowerShell 5.1/7 N56 scope regressions,
  Node/Vitest+MySQL, API/MySQL and the actual Windows EXE/MSI job. Installer
  steps specifically passed WiX packaging, administrative MSI extraction,
  real Windows installation/clean uninstall, and major upgrade retaining
  tenant configuration.
- Fresh post-merge `main` [deployment safety run 44738371382](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44738371382):
  **2/2 SUCCESS**, including real isolated MySQL backup/restore and offline
  Bash/database recovery.
- As required for unsigned automatic push diagnostics, the protected
  **Verify final signed artifact publication** and **Upload verified signed
  artifacts only** steps both **SKIPPED**. Actual production publisher/HSM
  signing, independent reviewer secret custody and N55 signed upload remain
  unexecuted. **Customer production NOT APPROVED.**
