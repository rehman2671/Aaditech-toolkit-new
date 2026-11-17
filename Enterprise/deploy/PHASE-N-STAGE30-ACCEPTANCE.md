# Phase N Stage 30 — MSI Pending Queue and Protected Receipt Retention

**Status: CODE/CI ACCEPTED — CUSTOMER PRODUCTION BLOCKED (2026-11-18 IST).**

## Verified automation and Windows upgrade evidence

- [PR #20](https://github.com/rehman2671/Aaditech-toolkit-new/pull/20) squash-merged to main as `3aa28aee3061f5b70ee81dca9b6460f67837e6ac`.
- [PR CI #44189789034](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44189789034): **SUCCESS** Node/Vitest (coverage >=70%), PowerShell; real MySQL/API (migration 015, 400-day active-tenant receipt still dedupes, preview cannot delete, explicit confirmed 180-day bounded cleanup protects live tenants, device-backed orphan and recent orphans). PR diagnostic Windows MSI intentionally **SKIPPED**.
- [PR deployment safety #44189788957](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44189788957): **SUCCESS 2/2**.
- [Main CI #44190267130](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44190267130): **SUCCESS 4/4** — Node/Vitest, PowerShell, genuine MySQL/API, real Windows ps2exe/WiX diagnostic MSI build, extraction, installation/uninstall and upgrade.
- Main Windows job log states **"N30 PASS: real SQLite integrity, persistent queue UUID, pending outbox and exact JSON survived major upgrade."** Major upgrade **1.1.2001 -> 1.1.2002** additionally preserved HTTPS/tenant/device configuration; upgraded MSI uninstalled cleanly.
- [Main deployment safety #44190267337](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44190267337): **SUCCESS 2/2**.
- **Signed public artifact upload remained SKIPPED**, and all tests used isolated CI/disposable Windows, not a physical customer deployment.

## Correctness and test scope

Stage N29 saves the exact HTTP JSON body in the Windows SQLite outbox during
ACK loss. Previous genuine MSI upgrade rehearsal verified tenant/server
configuration and enrollment credentials but did not seed or read a pending
SQLite queue. We now exercise the actual bundled sqlite3.exe after base MSI
installation. The test seeds a queue identity, two pending local events and an
unacknowledged telemetry_outbox request. It reads back the SQLite integrity,
queue UUID, event IDs and byte-identical JSON before and after a genuine WiX
major upgrade.

Server batch receipts are compact deduplication tombstones. Deleting a receipt
solely because measured history ages out could permit an old HTTP replay to
generate another history/alert/outbox record. Migration 015 adds an age index
without modifying prior receipts. The new maintenance routine is **dry-run by
default** and never automatically prunes active tenant receipts. Actual deletion
requires explicit platform-admin confirmation, age at least 180 days, limit
1–500, no existing tenant record and no remaining enrolled devices for that
tenant, rechecked in the conditional SQL DELETE itself.

The platform-admin-only POST
/api/v1/settings/retention/batch-receipts accepts a strictly validated request
with dry_run, min_age_days, max_rows, and confirm. General scheduled telemetry
history retention does not erase the receipt keys. The disposable MySQL rehearsal
tests a 400-day active receipt that must still dedupe; a recent orphan, a
deleted tenant with a remaining enrolled device, and an aged truly orphaned
receipt. Actual cleanup requires the explicit confirmation phrase
PURGE_DECOMMISSIONED_BATCH_RECEIPTS.

## Acceptance checklist

- [x] PR Node/Vitest, PowerShell, real MySQL/API and safety checks.
- [x] Main Windows EXE/WiX MSI build, SQLite-before/after major upgrade fixture,
      install/uninstall, and 4/4 CI plus 2/2 deployment safety.
- [ ] Physical enrolled customer Windows test with NETWORK SERVICE, real lost
      HTTP ACK, restart, upgrade and eventual server-acknowledged replay.
- [ ] Customer-authorized encrypted offsite MySQL restore, migration 015,
      Hostinger production DNS/TLS, publisher-approved Authenticode signed MSI,
      real SMTP/webhook and Graph/Intune/ITSM acceptance.

**Limit:** Receipts for active tenants can grow and require monitoring/storage
capacity. Actual external notification delivery and legacy unkeyed telemetry
are not exactly-once. No signed/public release or live customer deployment is
claimed by disposable CI.
