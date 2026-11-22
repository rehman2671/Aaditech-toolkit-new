# Phase N Stage 65 — Approved NUPKG archive entry safety before extraction and tool restore

**Status: CODE PROPOSED; WINDOWS CI AND REVIEW PENDING; PUBLIC SIGNING AND CUSTOMER PRODUCTION NOT APPROVED (2026-11-22 IST).**

## Remaining risk addressed

N63 verified independently reviewed PS2EXE/WiX package archive SHA-256 before use, and N64 attested the installed PS2EXE module tree. But the protected path did not yet reject hostile ZIP metadata, ambiguous Windows file names, duplicate case-folded paths, reparse/symlink entries or excessive decompression **before** `Expand-Archive` (PS2EXE) or `dotnet tool install` (WiX). Independent approval hashes constrain which archive can be used, but do not automatically prove every ZIP entry is safe or bounded.

## Proposed code gate

1. `Enterprise/agent/build/CompilerArchiveSafety.psm1` performs a read-only `.nupkg` ZIP preflight after the N63 approved archive hash: rejects absolute/traversal/drive/alternate-stream paths, backslashes, ambiguous Windows reserved/device names, malformed separators and segments, duplicate case-insensitive entry paths, Unix symlink/Windows reparse attributes, and malformed archives.
2. Per-entry/total decompression limits: PS2EXE archive at most 16 MiB compressed, 32 MiB per entry and 64 MiB total expanded; WiX archive at most 256 MiB compressed, 256 MiB per entry and 512 MiB expanded; at most 4,096 entries each, with a bounded compression ratio for large entries. Every archive entry is actually streamed with bounded reads rather than trusting ZIP metadata alone.
3. Protected `Install-ApprovedCompiler.ps1` now requires N63 SHA identity **then** N65 entry safety **before** PS2EXE extraction or WiX local-only restore. The copied PS2EXE extraction ZIP must still match the human-approved N63 SHA-256 before `Expand-Archive`. The WiX local-feed copy retains N63's independent approved digest recheck.
4. New offline synthetic PowerShell 5.1/7 tests cover a valid ZIP, traversal, Windows alias/NTFS-stream paths, duplicate case-folded names, symlinks/reparse metadata, malformed ZIP and a decompression limit violation; source-order assertions check no unsafe extraction or restore proceeds ahead of N63/N65 gates.

## Acceptance boundaries

- [x] Code and regression tests proposed in N65 feature branch. No external packages or customer files were downloaded to construct test fixtures.
- [ ] PR Windows PowerShell 5.1/7, Node/MySQL, API/MySQL and deployment-safety results; security review and merge: **PENDING**.
- [ ] Fresh merged main Windows diagnostic EXE/MSI build, administrative extraction and tenant-preserving MSI upgrade: **PENDING**.
- [ ] Owner approval of actual N63 NUPKG digests, protected manual restored tools, original independent reviewer authorization, publisher/HSM certificate signing, public GitHub draft asset attestation, Hostinger/customer Windows/database restore evidence: **PENDING**.

**Threat boundary:** This is defense-in-depth around **independently approved archive bytes**. It does not certify external package provenance or eliminate every concurrent write/TOCTOU attack. No signed public installer was authorized or published. **Production NOT APPROVED.**
