# Phase N Stage 64 — whole PS2EXE module payload integrity across protected build steps

**Status: PR #59 CI 3/3 + DEPLOYMENT SAFETY 2/2 SUCCESS; INDEPENDENT REVIEW AND FRESH MAIN MSI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-21 IST).**

## Finding

N63 independently pins the downloaded PS2EXE NUPKG, but previously checked only
`ps2exe.psd1` after copying extracted files into the Windows PowerShell module
directory. An altered `ps2exe.psm1`, added helper, or removed nested dependency
could survive the manifest-only copy comparison. The next build step independently
imported a versioned module path, but did not recheck the copied module code.

## Scope of N64

- `ApprovedCompilerPayload.psm1` builds an ordinally sorted SHA256 digest
  of the *complete extracted module payload*: relative file paths plus content
  SHA256 values. It rejects reparse points, missing compiler entrypoints,
  added/removed files, excessive file count and oversized extracted content.
- After N63 archive verification and extraction, the protected installer now
  fingerprints the source payload; it checks that the **entire installed copy**
  matches before any compiler import and passes the fingerprint to subsequent
  GitHub Actions steps through `GITHUB_ENV`.
- `Assert-N62InstalledPs2Exe` now requires that same N64 fingerprint and
  checks the installed module's full file set **before** protected import.
  The diagnostic `push` build remains unsigned and does not claim production
  supply-chain approval.
- `Test-Stage64ApprovedCompilerPayload.ps1` exercises offline synthetic
  manifest/code/dependency payloads, changed module code, added and deleted
  files, invalid fingerprints, optional Windows symlink cases and source-order
  guards on Windows PowerShell 5.1 and 7.

## Verified PR evidence

- [PR #59](https://github.com/rehman2671/Aaditech-toolkit-new/pull/59) code head `f1f8f5ab4a2bf960edd54322973704dcf5ab519b`.
- [PR CI 44828959128](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44828959128): **3/3 SUCCESS** — both N64 Windows PowerShell 5.1 and 7 offline tests, N62/N63/prior Windows security suite, Node/Vitest+MySQL, API/MySQL. PR MSI job intentionally skipped.
- [PR deployment safety 44828959211](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44828959211): **2/2 SUCCESS** — independent MySQL restore and offline recovery tests.
- These are **diagnostic/offline tests only**; neither protected signing nor genuine release happened.

## Acceptance

- [ ] Reviewed security change merged to main; Windows 5.1/7 N64 and
  previous regression suites green; real main diagnostic MSI build green.
- [ ] Independent N63 package SHA approval secrets, N56 human-signed release
  authorization, publisher signing, private draft/public hosted digest
  attestation, customer Hostinger/DNS/TLS and physical Windows enrollment
  acceptance **REMAIN PENDING**.

This offline file-tree digest is a runner continuity check, not a substitute
for independent NUPKG approval, endpoint security, trusted signing keys or
a real protected release run. **Customer production NOT APPROVED.**
