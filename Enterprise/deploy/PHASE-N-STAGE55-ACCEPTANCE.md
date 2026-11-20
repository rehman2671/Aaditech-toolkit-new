# Phase N Stage 55 — Reverify exact signed artifacts at final publication

**Status: MERGED; PR CI 3/3 AND SAFETY 2/2 SUCCESS; FRESH MAIN DIAGNOSTIC EXE/MSI 4/4 + SAFETY 2/2 VERIFIED; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Finding

Earlier release signing validates the signed EXE before WiX packaging, and N54
validates SQLite archive/executable bytes and the administratively extracted
MSI payload before the final Authenticode signing call. However, the automatic
workflow runs a *real MSI install/uninstall and major upgrade rehearsal after
signing*. There was no explicit final verification of the exact EXE/MSI and
checksum manifest **after these privileged operations and immediately before
`upload-artifact`**. An accidentally replaced or altered build file could
otherwise be selected for publication based on a prior `PUBLISH_SIGNED=true`
flag. This is an end-of-pipeline integrity window, not an observed real-world
artifact compromise.

## Implementation

- `Enterprise/agent/build/ReleaseArtifactManifest.psm1`: bounded offline
  validator of the actual `build/out/SHA256SUMS.txt`, installed EXE and
  exactly one expected-version MSI. Requires two canonical ASCII records,
  lower-case 64-hex SHA-256, strict filenames/order, and final linefeed
  (Windows CRLF or LF). Refuses missing, extra or duplicate entries; wrong
  version, additional MSI, UNC, nonlocal fixed-disk, reparse, zero/oversized
  files and any digest mismatches. Uses read-only, no-write-share SHA-256
  streams, compares 32 digest bytes, emits redacted failure only.
- `Enterprise/agent/build/Verify-SignedPublication.ps1`: operator-unattended
  but protected manual **`workflow_dispatch` on `main` only**, after earlier
  `RELEASE_SIGNING_ENABLED=true` and `PUBLISH_SIGNED=true` flags. Requires
  the independently approved exact publisher certificate thumbprint and
  SQLite executable digest. Verifies the canonical checksum manifest and
  both existing OS-trusted timestamped Authenticode signatures; then does a
  fresh MSI administrative extraction of the exact file intended for upload,
  verifies one actual embedded SQLite executable against N54's independent
  digest and checks the embedded EXE matches the release EXE. It separately
  checks the unsigned `agent-config.json` upload template and every signed
  MSI `agent.json`: all must still require first-run setup, with no endpoint,
  enroll URL, token or bootstrap token, even after the privileged MSI tests.
  Repeats manifest and trusted-signature checks before writing `PUBLICATION_VERIFIED=true`
  to the protected GitHub Actions environment.
- `.github/workflows/ci.yml`: adds this check **after** real Windows
  MSI setup/uninstall and major upgrade; changes signed artifact upload to
  require **both** `PUBLISH_SIGNED=true` and
  `PUBLICATION_VERIFIED=true`. Missing, altered or unsigned artifacts,
  digest mismatch, wrong embedded SQLite bytes, invalid/missing signature,
  failed MSI extraction, or a non-manual build block publication.
  Automatic push and PR diagnostic runs remain non-publishable.

The final gate **does not sign anything**, load a private PFX, mint a
fingerprint, connect to a customer host, or claim HSM key custody. A process
with privileged control of the runner still requires independent infrastructure
controls. Reviewer-held publisher signing and trusted certificate issuance
are external production requirements.

## Offline regression

`Enterprise/tests/Test-Stage55SignedArtifactPublication.ps1` runs on real
Windows PowerShell **5.1 and 7** with synthetic text files, not actual
installer signing keys. It checks:

1. Exactly two canonical SHA256SUMS records, CRLF/LF accepted.
2. Refusal of reordered, duplicate, truncated, extra or tampered hashes.
3. Refusal of a different expected agent version, invalid version string
   or two MSI candidates.
4. Refusal of EXE/MSI mutation *after* manifest creation.
5. Static final workflow control order: install, upgrade, final verification,
   then upload with two independent gating flags; reviewer thumbprint,
   Authenticode, N54 embedded SQLite verification must all be present.

## Acceptance

- [x] Windows PowerShell 5.1 and 7 N55 tests and N31–N54 baseline green.
- [x] PR Node/Vitest+MySQL, API/MySQL and deployment-safety checks green;
  PR #50 merged at reviewed head.
- [x] Independently verified fresh `main` Windows diagnostic EXE/MSI lifecycle
  **4/4 SUCCESS** and deployment safety **2/2 SUCCESS**.
- [ ] Protected manual production-signing run with exact independently
  reviewed SQLite/publisher fingerprints and successful N55 final check,
  actual publication and independent human signing custody **PENDING**.
- [ ] Customer Hostinger DNS/TLS, operator-approved signed health origin,
  physical lost-ACK+MySQL receipts, encrypted offsite recovery and authorized
  security owner sign-off **PENDING**.

**Production NOT APPROVED.** Security tracking: [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Previously independently verified main baseline

- [N54 main CI 44730648241](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730648241):
  Windows diagnostic EXE/MSI build, administrative extraction,
  install/uninstall and major upgrade, PowerShell/Node/API **4/4 SUCCESS**.
- [N54 main safety 44730648172](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730648172):
  isolated MySQL backup/restore and offline recovery **2/2 SUCCESS**.
- These are **pre-N55 main** diagnostic runs; they do **not** verify N55
  final publication, real publisher-signing keys or customer deployment.

## Verified N55 PR and merged head

- [PR #50](https://github.com/rehman2671/Aaditech-toolkit-new/pull/50)
  head `8e0f519b2bbdcc6287aac604b909232cc8959b21` merged at
  `0d39f773162bb32f00b47898903ddb0b89b460e3`.
- [PR CI 44733275703](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733275703):
  Windows PowerShell **5.1 and 7** final-publication N55 tests and earlier
  security suite, Node/Vitest+MySQL, API/MySQL **3/3 SUCCESS**. PR MSI
  diagnostic build **SKIPPED** as expected.
- [PR safety 44733275562](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733275562):
  real isolated MySQL backup/restore plus offline Bash recovery **2/2 SUCCESS**.
- Post-merge `main` [CI 44733652919](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733652919): **4/4 SUCCESS**, including Windows PowerShell tests, Node/Vitest+MySQL, API/MySQL and the actual Windows EXE/MSI build. MSI steps individually passed administrative extraction, real installed setup/clean uninstall and major upgrade retaining tenant configuration.
- Post-merge `main` [safety 44733653033](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733653033): **2/2 SUCCESS**, Bash/offline recovery and real isolated MySQL backup/restore data integrity.
- Manual production publisher-signing and final `PUBLICATION_VERIFIED`
  execution have **not** happened. No artifact was publicly signed or
  delivered to a customer. **Production NOT APPROVED.**

## Diagnostic versus production publication decision

In N55 `main` run 44733652919, the protected step **Verify final signed artifact publication** and **Upload verified signed artifacts only** both reported **SKIPPED**, which is the intended non-publishable behavior for a normal unsigned `push` diagnostic build. The code-level N55 revalidation policy and synthetic mutation faults passed Windows PowerShell 5.1/7, but actual publisher-signed end-of-pipeline execution awaits independently approved production credentials and a human-protected `workflow_dispatch` on `main`. **Customer production NOT APPROVED.**
