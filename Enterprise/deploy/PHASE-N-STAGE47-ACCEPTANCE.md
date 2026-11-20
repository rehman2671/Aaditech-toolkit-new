# Phase N Stage 47 — Fail-Closed Windows HTTPS Response Cleanup

**Status: MERGED; MAIN CI/MSI 4/4 AND DEPLOYMENT-SAFETY 2/2 GREEN; CUSTOMER PRODUCTION NOT APPROVED (verified 2026-11-20 IST).**

## Security finding

The N42–N46 separately consented Windows public HTTPS health probe writes a
bounded `/healthz` body into an ACL-protected per-invocation directory.
Until N47 the wrapper's `finally` clause called `Remove-Item` with
`-ErrorAction SilentlyContinue`. If Windows Defender, an AV scanner,
a backup handle, another process, or a filesystem error prevented deletion,
the wrapper could still publish **`https_health_probe=PASS`** with health
response bytes retained on the operator's disk. Inherited response data
contains no agent token by design, but lack of verified cleanup should never
be treated as a successful diagnostic.

## N47 implementation

- `PrivateWindowsProbeWorkspace.psm1` tracks only workspaces created
  successfully **in the current module session**. Its new
  `Remove-PrivateWindowsProbeWorkspace -Workspace` verifies the exact
  registered local profile directory and canonical `response.json`
  filename, rejects reparse-point directory/file and all unexpected children,
  and deletes only the known response file and **non-recursively** its own
  empty directory. It verifies the directory no longer exists before
  returning `$true`. Error messages are fixed/redacted.
- A locked response file, unexpected sibling or replaced directory fails
  **closed** instead of silently deleting arbitrary content. Failed cleanup
  leaves its module-session record so the operator/test may retry after
  resolving a transient lock. If the response was already deleted but the
  owned directory remained, an empty-directory retry is permitted.
- The live wrapper `Test-WindowsPinnedPublicHttps.ps1` now invokes this
  helper in `finally`, **before** constructing the immutable redacted
  report. If removal cannot be verified, it forces
  `https_health_probe=BLOCKED` and
  `diagnostic_phase=PRIVATE_WORKSPACE_CLEANUP`. It never publishes PASS
  after an observed cleanup failure, and retains
  `certified_for_production=false`.
- The N39–N43 operator-approved hostname and public-IP-pinned HTTPS
  safeguards, N46 atomic ACL directory creation, no automatic MSI/agent
  probe, and N31 `-NetworkProbe` BLOCKED policy are unchanged.

## Regression matrix

`Enterprise/tests/Test-Stage47WindowsProbeCleanup.ps1` is strictly offline.
On **real Windows PowerShell 5.1** and **PowerShell 7**, it tests the local
workspace lifecycle, response-byte cleanup, rejection of a replayed/forged
workspace, refusal to delete an unrelated sibling file, refusal on Windows
exclusive file lock and successful retry after releasing that lock, and
safe recovery when only the empty owned directory remains. It validates
that the operator report's cleanup decision occurs before report
construction; no valid live consent, DNS query, curl invocation or customer
endpoint is used. Existing N31–N46 regression gates remain in place.

## Acceptance gates

- [x] Offline N47 Windows PowerShell 7 and 5.1 file-lock, foreign-file,
      partial-delete and forged-identity tests passed.
- [x] Existing Windows N31–N46, Node/Vitest+MySQL, isolated API/MySQL and
      deployment-safety PR checks passed; PR #42 merged.
- [x] Main-branch Windows EXE/MSI build, extraction, real install/uninstall
      and tenant-preserving major upgrade **4/4** plus deployment safety
      **2/2** independently passed.
- [ ] Independently witnessed physical customer Windows cleanup/AV behavior,
      approved DNS/TLS and Hostinger public trust ownership, real
      publisher-signed MSI custody, authenticated lost-ACK/MySQL receipts,
      offsite restore, integrations and security-owner sign-off remain
      **PENDING**.

## Limitations

The cleanup lifecycle is deliberately fail-closed but cannot prevent all
same-user malicious process interference, Windows administrator/SYSTEM
takeover or an unexpected system crash. The fixed N44 evidence format audit
is not an independently signed attestation. A local healthy result
**never** approves deployment. Real customer endpoint access and
production signed MSI publication require separate authorization.

**Production NOT APPROVED.**
[Security issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29)
remains OPEN.

## Verified GitHub evidence — NOT production acceptance

- [PR #42](https://github.com/rehman2671/Aaditech-toolkit-new/pull/42) merged verified head `4cccd32afc0e7ac6ce4b518fe21a476715179765` into `main` as `d70bc960d511288be81fee236663c6096f9da8c5` following Windows PowerShell 5.1 and 7 N47 no-network cleanup fault tests, Node/Vitest+MySQL, isolated API/MySQL and deployment-safety regressions.
- [Main CI #44671007434](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44671007434): **4/4 SUCCESS** — PowerShell, Node/Vitest+MySQL, API/MySQL, Windows EXE/MSI build, Windows Installer administrative extraction, fresh install/uninstall and major-upgrade configuration-preservation rehearsal.
- [Main safety #44671007490](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44671007490): **2/2 SUCCESS** — offline recovery/shell safeguards and isolated MySQL backup/restore.
- The diagnostic `Verify pre-signed MSI payload and sign release MSI` step completed, but `Upload verified signed artifacts only` was **SKIPPED**. No public customer-publisher-signed MSI or production signing-custody approval resulted.
- No independently approved customer physical TLS/AV cleanup drill, real Hostinger DNS/CA ownership, authenticated lost-ACK receipts, encrypted offsite restore or human security sign-off was evidenced. Issue #29 remains OPEN, production NOT APPROVED.
