# Phase N Stage 30 — MSI Pending Queue and Protected Receipt Retention

**Status: CODE PROPOSED; PR/main CI PENDING; CUSTOMER PRODUCTION BLOCKED.**

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

- [ ] PR Node/Vitest, PowerShell, real MySQL/API and safety checks.
- [ ] Main Windows EXE/WiX MSI build, SQLite-before/after major upgrade fixture,
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
