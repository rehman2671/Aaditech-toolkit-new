# Phase N Stage 29 — Atomic keyed telemetry replay

**Status: CODE/CI ACCEPTED — CUSTOMER PRODUCTION BLOCKED (2026-11-18 IST).**

## Verified automation results

- [PR #19](https://github.com/rehman2671/Aaditech-toolkit-new/pull/19) squash-merged as `5de1def715f02b7494c7c0dc1c7585cf6d1aee94`.
- [PR CI #44186086779](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44186086779): **SUCCESS** — Node/Vitest, PowerShell mock tests for byte-identical queued HTTP replay and fail-closed batch ACKs, real MySQL/API transaction rehearsal (16 concurrent exact direct inserts, 8 concurrent authenticated HTTP requests, rollback on notification validation failure, tenant ownership, 409 conflict). PR Windows MSI job intentionally **SKIPPED**.
- [PR deployment safety #44186086815](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44186086815): **SUCCESS 2/2** — isolated MySQL backup/restore and offline shell safety.
- [Main CI #44186527404](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44186527404): **SUCCESS 4/4** — Node/Vitest, PowerShell behavioral checks, real MySQL/API, Windows real ps2exe agent and WiX diagnostic MSI build/extraction/install/uninstall/major-upgrade preserving server/tenant credentials and configuration.
- [Main deployment safety #44186527011](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44186527011): **SUCCESS 2/2**.
- `Upload verified signed artifacts only` remained **SKIPPED**. A successful diagnostic MSI pipeline is NOT signed public-release acceptance.


## Prior correctness defect

The canonical agent retained an unacknowledged event outbox row, but each retry
recollected fresh host metrics and sent a new HTTP body. The API used an async
telemetry memory queue, an independent device update and separate alert/outbox
transactions. If the HTTP ACK was lost, the same user action could add another
measured history point and another alert even though N28 event-row dedup worked.
A crash during ingestion could also leave partial durable effects.

## Stage N29 design

1. Introduce `014_telemetry_batches.sql` for a durable SHA-256 request receipt
   uniquely scoped by **authenticated tenant + enrolled device + client batch ID**.
   The server also stores a random insertion-winner nonce because mysql2
   CLIENT_FOUND_ROWS cannot reliably identify a duplicate no-op.
2. On keyed HTTP requests, validate the batch ID, compute a SHA-256 over the
   exact JSON request, and transactionally claim the receipt. A duplicate with
   identical request data returns original accepted count and recorded time
   and **does not touch health evidence, history, processes, events, alerts
   or notification jobs**. Altered body with the same batch ID returns HTTP 409.
3. New keyed ingestion uses one InnoDB transaction for enrolled-device ownership
   check, device evidence, measured history, optional process inventory, keyed
   event rows, alert rows and enabled-channel notification outbox rows. Failure
   anywhere rolls the transaction back, leaving the batch ID reusable.
   Legacy unkeyed clients continue on the old compatibility path.
4. The Windows MSI worker persists the **serialized HTTP body** and associated
   local outbox row IDs in its SQLite `telemetry_outbox` before POST, guarded
   by a unique pending-row index. It retries those exact bytes until the API
   returns matching batch ID + accepted count. A fresh host snapshot uses a
   fresh batch ID only after successful ACK.
5. CI exercises agent PowerShell mock behavior plus real disposable MySQL:
   parallel inserts/replays, authenticated HTTP retry, tenant/device ownership,
   altered-body conflict, and rollback on notification validation failure.

## Explicit limitations and external gates

- [x] Node/Vitest, PowerShell, isolated real MySQL/API CI, deployment-safety.
- [x] Main genuine Windows EXE/WiX MSI extraction/install/uninstall/major-upgrade (server/tenant configuration and enrolled credentials verified; pending SQLite queue preservation is **not** separately exercised).
- [ ] Live physical tenant-enrolled Windows with deliberate lost ACK and server
      restart, and post-MSI-upgrade persisted queue evidence.
- [ ] Authorized encrypted offsite production MySQL restore and migration 014.
- [ ] Authorized Hostinger VPS/DNS/TLS and signed public Authenticode EXE/MSI.
- [ ] Actual SMTP inbox/webhook receipt, Graph/Intune or ITSM integrations.

This is a **database transaction / HTTP ACK idempotency** guarantee for new
keyed clients, not exactly-once external notification delivery. Cache
invalidation remains best effort; legacy unkeyed traffic stays outside the
transactional batch dedup contract.
