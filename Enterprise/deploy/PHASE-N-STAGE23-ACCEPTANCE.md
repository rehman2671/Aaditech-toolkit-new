# Phase N Stage 23 — Atomic agent command claims and truthful execution results

**Status: STAGE 23 CODE/CI ACCEPTED; PRODUCTION BLOCKED.** [PR #13](https://github.com/rehman2671/Aaditech-toolkit-new/pull/13) merged. [Main CI #44054232799](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232799) **SUCCESS 4/4**, including real Windows diagnostic MSI install/uninstall/major-upgrade; [main deployment safety #44054232802](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232802) **SUCCESS 2/2**. Actual publisher-signed release, live Hostinger and physical customer Windows acceptance remain blocked.

## What Stage 23 corrects

- A previously successful-looking `POST /api/v1/commands/dispatch` could be emitted even after `queueCommandInDb` caught a real MySQL write failure and returned `false`. The queue also held a shadow in-memory copy before insertion, and production command-by-ID reads could return this stale copy instead of MySQL.
- Two API workers (or simultaneous agent polls) could read the same `PENDING` command, independently sign it, unconditionally mark it in progress, and both deliver a potentially disruptive action. The old result endpoint unconditionally overwrote the completion status for any command whose device token verified, including results submitted before any poll or replayed after completion.
- Stage23 persists the command **before** in-memory fixture updates; production errors propagate and the route returns HTTP 503 rather than 201. Production command lookups/pending reads always use authoritative SQL, never the in-process shadow queue.
- The poll path cryptographically signs the command then atomically claims `PENDING → IN_PROGRESS` under `id + verified device_id + status`; only workers with `affectedRows=1` return a signed executable command.
- A result is accepted only once for the matching verified device when MySQL transitions `IN_PROGRESS → COMPLETED/FAILED` (`affectedRows=1`). Replays and premature results receive HTTP 409; DB faults receive HTTP 503. A failed database write must never be logged as executed or returned as success.
- The result schema rejects unknown status values, unexpectedly large outputs, non-integer/out-of-range exit codes, and unknown request fields.
- Approved remediation dispatch uses identical durable-write acknowledgment semantics and cannot fabricate a successful queue operation after DB failure.
- The offline test database mirrors compare-and-swap semantics instead of always returning `affectedRows=1`.

## Deliberate delivery semantics

- Claims are **at-most-once until explicit operator review**; an agent that crashes after claim can leave the command `IN_PROGRESS`. This deliberately avoids automatic replay of reboot/script commands whose execution outcome is unknown.
- Do **not** automatically turn timed-out in-progress commands back to pending. Future safe reconciliation would require device-side durable deduplication across supported agent modes, signed acknowledgments, replay controls, and an operator-approved command retry policy.
- Command result means **verified enrolled device reported this status and the SQL transaction recorded it**; it does not imply a third-party attestation or physical operator observation.

## Test and release gates

- New `tests/unit/command-lifecycle-stage23.test.js` validates MySQL outage handling, no ghost commands, no production fallback, concurrent CAS claims, device-bound terminal status, duplicate replay and invalid result body rejection.
- Real HTTP regression covers duplicated completion after success and a premature completion before polling.
- Acceptance requires successful PR Node/Vitest, PowerShell, MySQL/API fault injection and deployment safety; post-merge main Windows diagnostic MSI install/uninstall/upgrade and safety green.
- Live Hostinger, authorized customer offsite MySQL restore, public Authenticode-signed MSI, customer SMTP receiver and physical Windows UAC/upgrade remain unverified external gates. Microsoft Graph and Jira/ServiceNow/Zendesk are not connected.

## Verified Stage 23 evidence — 2026-11-17

- [PR CI #44053797392](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44053797392) **SUCCESS** after fixing test SQL predicate assertions; [PR safety #44053797380](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44053797380) **SUCCESS**.
- Merged PR #13 at `c53fc58fa276895bb391e21d648470954ee2e03f`.
- [Main CI #44054232799](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232799) **4/4 SUCCESS**: Node/Vitest including new command-state tests, PowerShell, real MySQL/API fault-injection, Windows diagnostic WiX MSI installation, uninstall and major-upgrade preservation.
- [Main deployment safety #44054232802](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232802) **2/2 SUCCESS**: MySQL 8 disposable recovery and offline deployment safety.
- Production signed installer publication, real customer Windows result attestation, authorized Hostinger VPS/DNS/TLS, offsite production MySQL restore, live webhook/SMTP mailbox, real Graph/Jira integrations remain **NOT ACCEPTED / NOT CONNECTED**.
