# Phase N Stage 65 — Approved NUPKG archive entry safety before extraction and tool restore

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; FRESH MAIN DIAGNOSTIC WINDOWS MSI 4/4 + SAFETY 2/2 SUCCESS; INDEX VERIFIED; PROTECTED SIGNING AND CUSTOMER PRODUCTION NOT APPROVED (2026-11-22 IST).**

## Remaining risk addressed

N63 verified independently reviewed PS2EXE/WiX package archive SHA-256 before use, and N64 attested the installed PS2EXE module tree. But the protected path did not yet reject hostile ZIP metadata, ambiguous Windows file names, duplicate case-folded paths, reparse/symlink entries or excessive decompression **before** `Expand-Archive` (PS2EXE) or `dotnet tool install` (WiX). Independent approval hashes constrain which archive can be used, but do not automatically prove every ZIP entry is safe or bounded.

## Proposed code gate

1. `Enterprise/agent/build/CompilerArchiveSafety.psm1` performs a read-only `.nupkg` ZIP preflight after the N63 approved archive hash: rejects absolute/traversal/drive/alternate-stream paths, backslashes, ambiguous Windows reserved/device names, malformed separators and segments, duplicate case-insensitive entry paths, Unix symlink/Windows reparse attributes, and malformed archives.
2. Per-entry/total decompression limits: PS2EXE archive at most 16 MiB compressed, 32 MiB per entry and 64 MiB total expanded; WiX archive at most 256 MiB compressed, 256 MiB per entry and 512 MiB expanded; at most 4,096 entries each, with a bounded compression ratio for large entries. Every archive entry is actually streamed with bounded reads rather than trusting ZIP metadata alone.
3. Protected `Install-ApprovedCompiler.ps1` now requires N63 SHA identity **then** N65 entry safety **before** PS2EXE extraction or WiX local-only restore. The copied PS2EXE extraction ZIP must still match the human-approved N63 SHA-256 before `Expand-Archive`. The WiX local-feed copy retains N63's independent approved digest recheck.
4. New offline synthetic PowerShell 5.1/7 tests cover a valid ZIP, traversal, Windows alias/NTFS-stream paths, duplicate case-folded names, symlinks/reparse metadata, malformed ZIP and a decompression limit violation; source-order assertions check no unsafe extraction or restore proceeds ahead of N63/N65 gates.

## Acceptance boundaries

- [x] [PR #65](https://github.com/rehman2671/Aaditech-toolkit-new/pull/65) merged to main as `e52bd5652d580cf031413ab05f0546afdeb96299` after green GitHub checks. No separate human signing/security-owner acceptance is implied.
- [x] [PR CI #45026179982](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026179982) **3/3 SUCCESS**, including N65 real Windows PowerShell **5.1 and 7** synthetic ZIP safety regressions, previous N31–N64 PowerShell tests, Node/Vitest with MySQL and API/MySQL; MSI job skipped on PR. [PR safety #45026179985](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026179985) **2/2 SUCCESS**.
- [x] [Merged main CI #45026463843](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026463843) **4/4 SUCCESS**, including authentic diagnostic Windows EXE/MSI build, MSI administrative extraction, real Windows install/post-setup/clean uninstall and tenant-preserving major upgrade. [Main safety #45026463832](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026463832) **2/2 SUCCESS**, [project-index maintenance #45026463839](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026463839) **SUCCESS**.
- [x] Protected N63 compiler archive installation, final signed-artifact publication and artifact upload were **SKIPPED** in diagnostic main CI. They are NOT verified by these green runs.
- [ ] Owner approval of actual N63 NUPKG digests, protected manual restored tools, original independent reviewer authorization, publisher/HSM certificate signing, public GitHub draft asset attestation, Hostinger/customer Windows/database restore evidence: **PENDING**.

**Threat boundary:** This is defense-in-depth around **independently approved archive bytes**. It does not certify external package provenance or eliminate every concurrent write/TOCTOU attack. No signed public installer was authorized or published. **Production NOT APPROVED.**
