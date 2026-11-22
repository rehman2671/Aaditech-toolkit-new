# Phase N Stage 66 — Protected WiX global-tool command and store continuity

**Status: IMPLEMENTATION PROPOSED; WINDOWS CI/PR REVIEW PENDING; PRODUCTION RELEASE NOT APPROVED (2026-11-22 IST).**

## Concrete threat addressed

Phase N63 independently verifies a human-approved WiX NUPKG SHA-256 and installs the package from an isolated, local-only NuGet source; N65 validates the archive metadata and decompression limits before restore. However, the N62 WiX check previously authenticated only `wix --version`. An executable earlier in PATH could claim the same version; furthermore, a swapped `wix.exe` global shim or modified package store after restore would not be detected before executing packaging code.

The .NET CLI global-tool install convention uses `%USERPROFILE%\.dotnet\tools\wix.exe` plus the sibling `.store\wix\<locked-version>` payload. N66 binds both to the exact restore result, then rehashes immediately before WiX is invoked by `build-msi.ps1`.

## Protection implemented

1. New `Enterprise/agent/build/WixToolContinuity.psm1` fingerprints the real global `wix.exe` shim and the complete version-pinned `.store\wix\<version>` hierarchy using SHA-256 hashes of every file, file lengths, relative paths and directories. Reject reparse points, malformed/missing members and excessive file counts or sizes.
2. Protected `Install-ApprovedCompiler.ps1 -Kind wix` computes both digests **after** N63's SHA-approved, N65-screened, cache-isolated local-only restore, **before** invoking the WiX CLI. It exports `N66_WIX_STORE_SHA256` and `N66_WIX_SHIM_SHA256` via `GITHUB_ENV`.
3. `Assert-N62InstalledWix` requires `Get-Command wix` to resolve to the exact expected global shim and both original digests to match **before** executing `wix --version` on protected manual main builds. Diagnostic, unsigned CI retains its existing version-pin behavior.
4. New offline tests use a **fake, never-executed** Windows global-tool layout and verify a clean baseline plus failure on PATH substitution, mutated/missing/added nested DLL, replaced shim, missing or malformed digests, and wrong version. Both Windows PowerShell 5.1 and PowerShell 7 execute the same synthetic regression suite.

## Acceptance evidence

- [x] Code, offline tests, and dual Windows PowerShell CI jobs authored on N66 branch.
- [ ] PR CI (PowerShell, Node/MySQL, API/MySQL) and deployment safety: **PENDING**.
- [ ] Merge and fresh main diagnostic EXE/MSI + actual Windows MSI extraction/install/upgrade: **PENDING**.
- [ ] Protected manual main build with independently approved actual PS2EXE/WiX NUPKG hashes, human-reviewed source/release scope, signed Windows publisher identity, production Hosted GitHub release assets, Hostinger VPS and physical customer Windows/offsite restore evidence: **PENDING**.

**Boundaries:** N66 is an installed-byte continuity check, not independent approval of any new compiler archive, not protection against every concurrent file mutation, and not proof of a live protected build. Normal push CI does not use protected package credentials or publish signed customer artifacts. **Customer production release NOT APPROVED.**
