# Phase N Stage 36 — Reconciled Deployment Preflight and Evidence Non-Overwrite

**Status: CODE PROPOSED; PR/MAIN CI PENDING; CUSTOMER PRODUCTION BLOCKED (2026-11-18 IST).**

## Provenance / parallel development reconciliation

Earlier [PR #22](https://github.com/rehman2671/Aaditech-toolkit-new/pull/22) developed the no-overwrite and public-DNS guards on an older main. Separately, [PR #23](https://github.com/rehman2671/Aaditech-toolkit-new/pull/23) shipped Stage32 physical Windows evidence, and Stages N33–N35 then shipped scoped MySQL receipts and signed operator registry. PR #22's proposed `PHASE-N-STAGE32-ACCEPTANCE.md` would overwrite N32's now-accepted customer evidence runbook, and its checklist would be stale. Stage N36 selectively ports the **seven original script/test changes** from #22 onto the latest main without copying its conflicting Stage32 document or rolling back N33–N35.

## Security/correctness changes

1. Stage14 and read-only Hostinger health CLI now reject case-insensitive reserved/documentation DNS zones and dotted all-numeric TLD hosts, which otherwise resemble allowed public DNS.
2. Stage31 revalidates the host with a **dry-run** before optional authorized live probe; no secret file is sourced or sent. Syntax validation alone does NOT prove DNS ownership, actual resolution, or security of all resolved addresses.
3. Linux Stage31 writes its 0600 redacted JSON into a temporary file in the destination directory and uses atomic hard-link creation to refuse concurrent publication/existing files. Failed link creation is **BLOCKED**, not silently treated as a successful `mv -n`. A hard link requires a suitable local filesystem; non-support is fail-closed.
4. Stage31 Windows customer preflight exclusively creates the acceptance report with `FileMode.CreateNew`, refusing overwrite of any file created between existence-check and write.
5. CI regression covers reserved/numeric hostnames, symlink destination, duplicate concurrent Linux writers, and existing Windows report byte integrity. Windows exclusive-create protects against overwrite; it does **not** by itself guarantee fully atomic multi-byte report visibility to concurrent readers.

## Merge gates

- [ ] PR Linux deployment-safety/isolated MySQL restore job successful.
- [ ] PR Windows PowerShell plus Node/Vitest and real MySQL/API checks successful.
- [ ] Independent code review and authorized merge. No bypass of branch protection.
- [ ] Main CI diagnostic Windows EXE/MSI build, setup and upgrade, plus deployment safety successful.
- [ ] Main release checklist updated with actual SHA/CI IDs and N36 code-accepted status after passing gates.

## External acceptance remains BLOCKED

Authoritative Hostinger VPS/DNS/TLS, real customer offsite restore, physical Windows outage and authenticated replay, verified root HSM/vault custody/operator approvals, signed public MSI, SMTP/webhook/Graph/ITSM acceptance, and actual customer deployment are NOT satisfied by this CI.
