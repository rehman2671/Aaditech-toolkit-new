# Phase N Stage 64 — Full PS2EXE module-tree continuity before protected compilation

**Status: CODE PROPOSED ON PR BRANCH; WINDOWS CI AND REVIEW PENDING; PRODUCTION NOT APPROVED (2026-11-22 IST).**

## Finding

N63 independently verifies the exact PS2EXE 1.0.18 NUPKG archive SHA-256 and imports the manifest from an explicit installed directory. However, after copying the reviewed archive contents to the Windows PowerShell module directory, the previous check compared only `ps2exe.psd1`. A modified `ps2exe.psm1`, nested dependency, stale extra file or symlink in the installed compiler tree could evade that manifest-only comparison. Exact module version and command alias checks do not authenticate all executable module bytes.

## Remediation

1. New `Enterprise/agent/build/CompilerModuleContinuity.psm1` builds a canonical SHA-256 fingerprint over **all** files and directories, relative paths, file lengths and per-file hashes in the extracted module tree. Rejects missing manifest/body, redirected/reparse entries, unexpected file types, excessive size or file count. The resulting module-tree digest is a **continuity record**, not a replacement for the independent N63 archive SHA approval.
2. N63's protected installer now compares the **complete reviewed extraction tree** to the full installed destination, refusing all added/removed/altered companion files. It exports `N64_PS2EXE_TREE_SHA256` through protected GitHub Actions step environment only after identical tree attestation; existing explicit `N63_PS2EXE_MANIFEST_PATH` remains required.
3. `Assert-N62InstalledPs2Exe` invokes the N64 full-tree digest check **before** loading the protected PS2EXE module. Since `build-agent.ps1` calls that admission before compilation, a post-copy change is detected at build time. Normal diagnostic push builds keep the N62 version check and remain nonpublishable.
4. The new offline `Test-Stage64CompilerTreeContinuity.ps1` uses synthetic module files only. It verifies parity, case-insensitive digest matching, modified compiler body, nested companion mutation, extra/missing files, malformed or missing digest and protected workflow ordering. Run on Windows PowerShell 5.1 and PowerShell 7 in CI.

## Verification and limitations

- [x] Implementation and offline regression script added to the N64 PR branch.
- [ ] GitHub Windows 5.1 and 7 N64 regressions, earlier suites, Node/Vitest+MySQL, API/MySQL and deployment-safety CI: **NOT YET VERIFIED**.
- [ ] Independent security review, merge approval and fresh main diagnostic EXE/MSI install and major-upgrade evidence: **PENDING**.
- [ ] Genuine independent N63 archive SHA approvals and the actual protected archive installation, reviewer authorization, publisher/HSM Authenticode, hosted release asset attestations, Hostinger VPS/DNS/TLS, customer Windows and database backup/restore signoffs: **PENDING**.

**Security boundary:** The digest is computed from the independently approved N63 archive's extracted contents; it is not an independently reviewed fingerprint itself. This detects changed or unexpected installed files at the two check points, but does not claim to eliminate malicious local processes, kernel compromise, or every possible time-of-check/time-of-use race. No signed/public installer has been published.

**Customer production NOT APPROVED.**
