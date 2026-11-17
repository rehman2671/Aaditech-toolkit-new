# Phase N Stage 27 — Idle-device telemetry cadence and fail-closed event ACK

**Status: CODE/CI ACCEPTED — PRODUCTION RELEASE BLOCKED (2026-11-18 IST).**

[PR #17](https://github.com/rehman2671/Aaditech-toolkit-new/pull/17) squash-merged to main at
`007c23a10e5cd46a6d71be0eacc90d56215a022e`.

## Verified automated acceptance

- [PR CI #44173185334](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44173185334): **SUCCESS** (Node/Vitest, PowerShell validation including N27 behavioral mocks, real MySQL/API); PR Windows diagnostic MSI job intentionally **SKIPPED**.
- [PR safety #44173185332](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44173185332): **SUCCESS 2/2** (disposable MySQL recovery and Bash safety).
- [Main CI #44173643947](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44173643947): **SUCCESS 4/4**, including PowerShell behavioral ACK tests, Node/Vitest, real MySQL/API fault injection, genuine Windows ps2exe + WiX MSI build, MSI administrative extraction, install/uninstall and major-upgrade retaining tenant configuration.
- [Main deployment safety #44173643755](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44173643755): **SUCCESS 2/2**.
- **Public release signing/publishing was not exercised**; the workflow's signed artifact upload step was **SKIPPED**. All code/CI acceptance is diagnostic, not production certification.

## Root cause and remediation

The canonical MSI worker had a 30-minute full-inventory cycle while
server-measured telemetry is fresh for only 15 minutes. N26 sent real
metrics/posture only when the worker had queued events, so a healthy quiet
device could show STALE measurements despite an active heartbeat.
Additionally, the worker marked pending SQLite events `delivered` after any
HTTP success without confirming the application's ACK envelope/count.

N27 makes `Send-AgentBatch` upload a fresh authenticated snapshot with
`events: []` when the queue is empty. Its server-ack gate requires
`status: OK` and a parsed integer `accepted` exactly matching queued event
count before marking **only those local pending SQLite rows** delivered.
Incorrect/missing/partial responses or network failures retain all pending
rows. A lightweight five-minute heartbeat/snapshot cadence runs between
full inventory cycles without re-running privileged collectors. PowerShell
behavioral mocks exercise empty queues, genuine zero values, exact ACK,
invalid/missing ACK, network outage and short-cadence semantics.

## Open risks and customer production acceptance

- [ ] Verify a physical enrolled customer Windows MSI with a **truly idle** queue
      reports measured CPU/RAM/system-disk regularly across at least 30 minutes;
      test real NETWORK SERVICE collector failures and offline recovery.
- [ ] Independently verify customer-device alerts, tenant boundaries, operator
      permissions and authorized live webhook/SMTP receipts.
- [ ] **At-least-once retry remains**: a server-committed event whose HTTP ACK
      is lost can be inserted again. Server-side deduplication by authenticated
      tenant/device and client message ID needs a later change; never claim
      exactly-once delivery.
- [ ] Obtain human-approved public Authenticode publisher signature and
      timestamp, authorized Hostinger VPS/DNS/TLS deployment/ownership,
      independent offsite production MySQL restore, physical managed Windows
      UAC/upgrade sign-off and tenant-specific acceptance evidence.
- [ ] Secure Boot/local-admin attestation, real Microsoft Graph/Intune and
      Jira/ServiceNow/Zendesk integrations remain unverified/not connected.

**Release decision: CODE/CI ACCEPTED; CUSTOMER/PRODUCTION NOT CERTIFIED.**
