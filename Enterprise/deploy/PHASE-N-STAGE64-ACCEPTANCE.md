# Phase N Stage 64 — Full PS2EXE module-tree continuity before protected compilation

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 PASS; FRESH MAIN DIAGNOSTIC WINDOWS EXE/MSI 4/4 + SAFETY 2/2 PASS; INDEX SUCCESS; HUMAN PROTECTED RELEASE AND CUSTOMER PRODUCTION NOT APPROVED (2026-11-22 IST).**

## Finding

N63 independently verifies the exact PS2EXE 1.0.18 NUPKG archive SHA-256 and imports the manifest from an explicit installed directory. However, after copying the reviewed archive contents to the Windows PowerShell module directory, the previous check compared only `ps2exe.psd1`. A modified `ps2exe.psm1`, nested dependency, stale extra file or symlink in the installed compiler tree could evade that manifest-only comparison. Exact module version and command alias checks do not authenticate all executable module bytes.

## Remediation

1. New `Enterprise/agent/build/CompilerModuleContinuity.psm1` builds a canonical SHA-256 fingerprint over **all** files and directories, relative paths, file lengths and per-file hashes in the extracted module tree. Rejects missing manifest/body, redirected/reparse entries, unexpected file types, excessive size or file count. The resulting module-tree digest is a **continuity record**, not a replacement for the independent N63 archive SHA approval.
2. N63's protected installer now compares the **complete reviewed extraction tree** to the full installed destination, refusing all added/removed/altered companion files. It exports `N64_PS2EXE_TREE_SHA256` through protected GitHub Actions step environment only after identical tree attestation; existing explicit `N63_PS2EXE_MANIFEST_PATH` remains required.
3. `Assert-N62InstalledPs2Exe` invokes the N64 full-tree digest check **before** loading the protected PS2EXE module. Since `build-agent.ps1` calls that admission before compilation, a post-copy change is detected at build time. Normal diagnostic push builds keep the N62 version check and remain nonpublishable.
4. The new offline `Test-Stage64CompilerTreeContinuity.ps1` uses synthetic module files only. It verifies parity, case-insensitive digest matching, modified compiler body, nested companion mutation, extra/missing files, malformed or missing digest and protected workflow ordering. Run on Windows PowerShell 5.1 and PowerShell 7 in CI.

## Verification and limitations

- [x] [PR #64](https://github.com/rehman2671/Aaditech-toolkit-new/pull/64) reviewed through GitHub CI and merged to main as `80334a42e86311b24e13e69845f047043092c7dc` on 2026-11-22 IST. No separate human release/security-owner attestation is implied.
- [x] [PR CI #45022600248](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022600248) **3/3 SUCCESS**, covering PowerShell 7 + Windows PowerShell 5.1 N64 full-tree and mutation regressions, previous suites, Node/Vitest + MySQL and API + MySQL. PR MSI build correctly skipped. [PR deployment safety #45022600246](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022600246) **2/2 SUCCESS**.
- [x] [Merged main CI #45022858422](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022858422) **4/4 SUCCESS**: PowerShell, Node + MySQL, API + MySQL, authentic diagnostic Windows EXE/MSI build, MSI administrative extraction, genuine Windows clean install/uninstall and major upgrade preserving tenant configuration. N64 offline tests **PASS on PS 5.1 and 7**. [Main safety #45022858450](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022858450) **2/2 SUCCESS**; [main index #45022858434](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022858434) **SUCCESS**.
- [x] Main diagnostic CI **SKIPPED** N63 protected independent archive-install steps, verified public signing and artifact upload. These skipped gates are **not** customer release success.
- [ ] Separate human security review, real authorized manual protected package installation, publisher certificate signing and public Release asset attestation: **PENDING**.
- [ ] Genuine independent N63 archive SHA approvals and the actual protected archive installation, reviewer authorization, publisher/HSM Authenticode, hosted release asset attestations, Hostinger VPS/DNS/TLS, customer Windows and database backup/restore signoffs: **PENDING**.

**Security boundary:** The digest is computed from the independently approved N63 archive's extracted contents; it is not an independently reviewed fingerprint itself. This detects changed or unexpected installed files at the two check points, but does not claim to eliminate malicious local processes, kernel compromise, or every possible time-of-check/time-of-use race. No signed/public installer has been published.

**Customer production NOT APPROVED.**
