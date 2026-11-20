# Phase N Stage 54 — Independently pinned SQLite binary inside production MSI

**Status: MERGED; PR CI 3/3 AND DEPLOYMENT SAFETY 2/2 GREEN; FRESH MAIN DIAGNOSTIC EXE/MSI 4/4 + SAFETY 2/2 VERIFIED; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Security finding

`Enterprise/agent/wix/build-msi.ps1` downloaded an executable ZIP from
`https://www.sqlite.org/2026/sqlite-tools-win-x64-3530400.zip` and
embedded `sqlite3.exe` without comparing the downloaded archive or the
extracted executable to an independently approved immutable checksum. A
successful HTTPS download and a successful WiX build alone do not prove the
binary was the one a release reviewer authorized.

The original signed-EXE/MSI gates sign the *resulting* package, so without
this control they could inadvertently sign a dependency whose bytes had
never been approved. This is a **release supply-chain gap**, not a claim
that the official SQLite site or its binaries are compromised.

## Code-level control

`Enterprise/agent/wix/SqliteBundleApproval.psm1` implements an offline
SHA-256 verifier for a bounded **local fixed-disk ordinary file**, rejecting
UNC, reparse points/ancestors, zero/oversize files, malformed or missing
64-hex approvals and mismatched bytes with one redacted exception.
It hashes a read-only, non-write-share stream, compares all 32 digest
bytes and returns only success/failure. The verifier never downloads or
executes a file and never manufactures an approved digest.

`build-msi.ps1` now:

1. Refuses **release-signable** packaging before download unless **both**
   `SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED` and
   `SQLITE3_EXE_SHA256_APPROVED` are independently supplied valid SHA-256
   digests. It does not infer either digest from downloaded content.
2. Downloads the fixed versioned official SQLite ZIP into a unique
   disposable working directory instead of using a mutable global TEMP cache.
3. Validates ZIP size/type and, in release mode, the approved ZIP SHA-256
   **before** archive expansion.
4. Requires exactly one bounded ordinary `sqlite3.exe` in the ZIP; in
   release mode validates its independently approved SHA-256 before copying
   and again after placing it in the WiX staging directory.
5. In GitHub Actions, rejects a missing signing-mode state rather than
   silently interpreting an unset mode as diagnostic. Automatic push/PR
   builds without production signing credentials remain explicitly
   **diagnostic and non-publishable**, and cannot claim an approved SQLite
   supply chain.

`.github/workflows/ci.yml` supplies these pins **only** to manually
dispatched jobs using the existing protected `production-installer`
environment, not to routine push or PR builds. Immediately before signing
the finished MSI, the workflow independently verifies the **actual SQLite
executable extracted from that MSI** against the approved executable digest.
Existing pre-signed agent EXE equality, timestamped Authenticode and
no-signing-on-push controls remain intact.

## Required independent reviewer inputs

A release owner must obtain and approve the **exact SHA-256 of the versioned
SQLite tools ZIP** and the **exact SHA-256 of the contained sqlite3.exe**
through independently reviewed distribution provenance, then configure these
as `SQLITE_TOOLS_ARCHIVE_SHA256_APPROVED` and
`SQLITE3_EXE_SHA256_APPROVED` in the restricted production-installer
environment. The values are deliberately **NOT** populated or inferred
from the CI download, repo source code, a local self-signed certificate, or
this synthetic test. Changing the version requires new security review and
new pins.

Missing/incorrect pins prevent signing-ready packaging and publication.
A green diagnostic MSI using downloaded SQLite bytes does **not** certify
a production dependency or authorize customer installation.

## Offline test plan

`Enterprise/tests/Test-Stage54SqliteBundleApproval.ps1` runs on actual
Windows PowerShell 5.1 and PowerShell 7 with local synthetic files only:

- correct independently supplied synthetic SHA-256, both hex cases;
- missing, malformed, incorrect and whitespace-polluted digests;
- mutated executable, swapped archive/EXE digest, zero/oversized input;
- UNC location and directory instead of an ordinary file;
- static fail-closed pipeline ordering: approval before archive expansion,
  extracted executable before stage, staged copy before WiX signing.

No real SQLite binary, production fingerprint, customer DNS/HTTPS or
publisher-signing key is used by the offline test.

## Remaining acceptance

- [x] PR Windows 5.1/7 N54 and N31–N53 baseline green.
- [x] PR Node/Vitest+MySQL, API/MySQL and deployment safety green; reviewed PR merged.
- [x] Independently inspected fresh **main** diagnostic Windows EXE/MSI lifecycle **4/4** and deployment safety **2/2**.
- [ ] Independently approve two real SQLite version-specific digests,
  actual reviewer key custody, genuine customer Hostinger DNS/TLS, protected
  publisher/HSM MSI signing, physical lost-ACK/tenant MySQL evidence, offsite
  restore and human security owner sign-off.

**Production NOT APPROVED.** See [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Verified GitHub evidence (not production approval)

- [PR #49](https://github.com/rehman2671/Aaditech-toolkit-new/pull/49)
  head `a6232634774db5a29f822c2d57ef9ff016e4a68e` merged into main at
  `79915aec4afca14997a21f7b5c5f4143f8cc8ef2`.
- [PR CI run 44730289683](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730289683):
  Windows PowerShell 5.1+7 N54 tests and prior safety regressions, Node/Vitest+
  MySQL and API/MySQL **3/3 SUCCESS**. Diagnostic EXE/MSI build correctly
  **SKIPPED** on the pull request.
- [PR deployment safety 44730289834](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730289834):
  offline recovery/Bash and isolated MySQL backup/restore **2/2 SUCCESS**.
- Fresh **main** diagnostic EXE/MSI install/upgrade/uninstall **4/4** plus
  safety **2/2** are independently verified in the push workflows below. An actual protected
  production signing run with independently approved exact SQLite archive
  and executable digests has **NOT** been performed.

## Verified post-merge main Windows acceptance — 2026-11-20 UTC

- Merge SHA `79915aec4afca14997a21f7b5c5f4143f8cc8ef2` independently correlated to [push CI run 44730648241](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730648241): **4/4 SUCCESS**, with Windows PowerShell validation, Node/Vitest+MySQL, API/MySQL, and **Build agent EXE + MSI SUCCESS**. MSI job steps explicitly passed EXE build, WiX MSI build, administrative MSI payload extraction, real Windows installation/setup and clean uninstall, and major upgrade retaining tenant/device configuration.
- Same merge SHA [push deployment-safety run 44730648172](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730648172): **2/2 SUCCESS**, isolated MySQL backup/restore integrity and offline Bash/database recovery.
- The runner did **NOT** publish a signed artifact (signed upload step skipped). No production SQLite reviewer hashes, real publisher keys, live Hostinger/customer checks, physical machine evidence or independent production security sign-off were established. **Customer production remains NOT APPROVED.**
