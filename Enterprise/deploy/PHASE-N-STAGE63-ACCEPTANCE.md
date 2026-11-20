# Phase N Stage 63 — Independently approved compiler package SHA-256 before use

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; FRESH MAIN DIAGNOSTIC WINDOWS EXE/MSI 4/4 + SAFETY 2/2 SUCCESS; INDEX VERIFIED; REAL PROTECTED PACKAGE INSTALL/SIGNED RELEASE PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-21 IST).**

## Finding

N62 pinned the **versions** of PS2EXE and WiX, but a package of the
same named version could still change upstream or be replaced by an
unreviewed distribution. The protected manual release build previously
downloaded and installed those packages directly from package
repositories, without a separately approved hash of the package archive
that was actually executed. A version lock alone is not an authenticated
package identity or reproducible provenance.

**N63 introduces a separate protected-build dependency approval.**
The release/security owner must independently retrieve, inspect and
approve the exact `ps2exe.1.0.18.nupkg` and `wix.5.0.2.nupkg` bytes,
and provision these two **64-hex SHA256** GitHub protected
`production-installer` environment secrets:

- `PS2EXE_NUPKG_SHA256_APPROVED`: SHA256 of the exact, independently
  reviewed PS2EXE 1.0.18 PowerShell Gallery NUPKG.
- `WIX_NUPKG_SHA256_APPROVED`: SHA256 of the exact, independently reviewed
  WiX 5.0.2 NuGet NUPKG.

**Do not calculate these approvals from the just-downloaded CI packages.
No checksum value has been assumed or filled in by the implementation.**
They remain unconfigured for actual production acceptance until an
authorized reviewer supplies them.

## Enforcement and scope

1. `.github/workflows/ci.yml` now separates diagnostic `push` tool
   installation from protected `workflow_dispatch` installation.
   Diagnostic builds retain N62's exact versions but have **no approved
   archive claim and are never publishable**. Both manual installation
   steps require the two protected NUPKG hash secrets, exact
   `workflow_dispatch`, `refs/heads/main`, authentic GitHub Actions
   context and repository identification. Missing or partial approvals
   fail **before any package download**; there is no fallback to an
   unverified module or public NuGet restore.
2. `Enterprise/agent/build/ApprovedCompilerPackage.psm1` checks regular
   non-reparse package files, exact expected N62 package filename and
   version, nonzero bounded size (16 MiB PS2EXE, 256 MiB WiX), and exact
   independently approved **SHA256 of downloaded archive bytes**. Bad
   filename, version, missing approval, changed bytes or oversized
   artifact fails closed with a redacted error.
3. `Enterprise/agent/build/Install-ApprovedCompiler.ps1` uses fixed
   HTTPS source URLs for those exact versions, downloads to a newly
   allocated private runner temporary directory, and refuses to
   extract, load or restore packages until the relevant N63 SHA gate
   succeeds. It does **not** later re-fetch that package.
4. For PS2EXE, only the **approved NUPKG** is expanded (using the
   documented PowerShell Gallery manual ZIP extraction procedure).
   Its manifest and module are copied to the Windows PowerShell 5.1
   user module path. The copied manifest hash must match the verified
   extracted manifest. The exact module manifest path is then passed
   to subsequent compilation via `GITHUB_ENV`. The N62 compiler
   admission now imports by that **explicit approved path** on protected
   manual builds, checks the loaded module base, version and authentic
   command, and rejects any other module discovered from PSModulePath.
5. For WiX, only the verified `wix.5.0.2.nupkg` is copied to an
   **isolated local NuGet feed**, and verified a second time. The
   generated `NuGet.Config` clears all upstream sources and adds only
   this local directory. The `dotnet tool install --global wix
   --version 5.0.2 --configfile <isolated path>` command uses a fresh
   temporary `NUGET_PACKAGES` and NuGet HTTP cache so a same-version
   upstream cached package cannot replace the approved archive. N62
   still verifies the installed executable's exact version before
   `wix build`.
6. Temporary downloads, isolated feed/config and cache are deleted,
   with hash inputs and source paths redacted from failure messages.
   The protected path never calls unrestricted `Install-Module` or
   restores WiX from a public feed after the SHA check.

## Offline Windows regression

`Enterprise/tests/Test-Stage63ApprovedCompilerPackages.ps1` is
exercised on **Windows PowerShell 5.1 and PowerShell 7** with fake
NUPKG contents only; it does not download a compiler, install a tool,
create an MSI or handle real signing/reviewer secrets. It checks:

- Valid independently approved PS2EXE and WiX hashes are accepted,
  case-insensitively, for exactly named, bounded synthetic files.
- Wrong/missing hashes, swapped package names, changing a file
  after approval, oversize files and folders masquerading as packages
  are rejected with a non-sensitive fixed error.
- Protected manual `main` context accepts both separately approved
  fingerprints; auto-push, pull request, non-main manual dispatch,
  missing or partial approved hashes all fail closed.
- Workflow source ordering ensures signed manual builds select **only
  the approved archive install**, not the diagnostic installers, and
  archive SHA checks precede PS2EXE expansion and isolated WiX restore.
- The verified module's explicit path is required by the protected
  Windows PS2EXE compiler entrypoint before invocation.

**This is an offline regression, not a test of live publisher credentials
or the real protected download and public GitHub Release.** A genuine
release still needs authorized package hash approvals and actual
protected installation/signing/reviewer/download/hosted asset evidence.

## Acceptance

- [x] PR N63 PS5.1/7 package identity/TOCTOU and context regressions,
  N31–N62 security suites, Node/Vitest+MySQL and API/MySQL
  **3/3 SUCCESS**; isolated MySQL safety **2/2 SUCCESS**.
- [x] Reviewed [PR #58](https://github.com/rehman2671/Aaditech-toolkit-new/pull/58)
  merged as `053788a2670ee66b229e50da6c6634bca3fb1126`;
  fresh diagnostic main PS2EXE/WiX EXE/MSI build, administrative
  extraction, actual installed setup/clean uninstall and major upgrade
  preserving tenant configuration **4/4 SUCCESS**, safety
  **2/2 SUCCESS**, project index refreshed successfully.
- [ ] Independent human supplier package review and real pinned
  SHA256 secrets, protected manual PS2EXE and WiX offline installation
  from downloaded archives, N56 reviewer RSA signature, publisher
  certificate/HSM, SQLite ZIP/EXE pins, N59–N61 real GitHub private
  draft and public asset attestation **PENDING**.
- [ ] Actual Hostinger customer DNS/TLS, physical Windows device
  enrollment, tenant lost-ACK/replay receipts, encrypted offsite DB
  restore and release/security-owner signoff **PENDING**.

**Customer production NOT APPROVED.**

External references:
[PowerShell Gallery manual package download](https://learn.microsoft.com/en-us/powershell/gallery/how-to/working-with-packages/manual-download),
[dotnet tool install with local source/configfile](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-install),
[PS2EXE 1.0.18](https://www.powershellgallery.com/packages/ps2exe/1.0.18),
[WiX 5.0.2](https://www.nuget.org/packages/wix/5.0.2).

Earlier verified baseline:
[N62 main CI 44820901522](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820901522)
**4/4 SUCCESS**, [safety 44820901397](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820901397)
**2/2 SUCCESS**, and final documentation
[CI 44821722828](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44821722828)
**4/4 SUCCESS** with [safety 44821722786](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44821722786)
**2/2 SUCCESS**. These precede N63 and do not certify a protected
customer production release.

## Verified N63 PR and post-merge main evidence

- [PR #58](https://github.com/rehman2671/Aaditech-toolkit-new/pull/58),
  reviewed head `7f98d7c5b1adf7a8c45c61ef3a2d1c2f28d321ea`,
  merge `053788a2670ee66b229e50da6c6634bca3fb1126`.
- [PR CI 44825229841](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825229841):
  **3/3 SUCCESS** — real Windows PowerShell 5.1/7 synthetic N63
  independently approved package SHA256/TOCTOU/size/context tests,
  prior N31–N62, Node/Vitest+MySQL and API/MySQL. MSI job skipped on PR.
- [PR safety 44825229888](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825229888):
  **2/2 SUCCESS** — isolated real MySQL backup/restore and offline
  deployment recovery.
- Fresh [main CI 44825709437](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825709437):
  **4/4 SUCCESS** — Windows PS 5.1/7, Node/Vitest+MySQL, API/MySQL,
  actual diagnostic PS2EXE EXE + WiX MSI build, MSI administrative
  extraction, real Windows install/clean uninstall and major upgrade
  preserving tenant configuration.
- [Main deployment safety 44825709377](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825709377):
  **2/2 SUCCESS**. [Main index maintenance 44825709447](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825709447):
  **SUCCESS**.
- On automatic diagnostic push `Verify final signed artifact publication`
  and `Upload verified signed artifacts only` both **SKIPPED**.
  The new **protected** `workflow_dispatch` archive download,
  independent SHA approval, local PS2EXE/WiX installation, publisher
  Authenticode signing and GitHub Release creation were **not**
  exercised in these runs. The real signing owner's compiler archive
  approval and N56 independent RSA authorization remain pending.
  **Customer production NOT APPROVED.**
