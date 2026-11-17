# Phase N Stage 27 — Idle-device telemetry cadence and fail-closed event ACK

**Status: CODE PROPOSED — PR/MAIN CI PENDING; PRODUCTION BLOCKED.**

## Issue

The canonical WiX MSI agent uses a 30-minute full-collection cycle while
the server considers measured telemetry stale after 15 minutes. Stage N26
added genuine fresh metrics/posture, but `Send-AgentBatch` returned early
when no SQLite outbox rows were waiting. A completely idle, healthy device
could never refresh measurements without another feature event.
Separately, any HTTP success was treated as full queue acknowledgment,
even when the response lacked the expected `status: OK` and matching
`accepted` count; this risked silent event loss.

## Changes

- Send an authenticated fresh telemetry/posture payload with `events: []`
  whenever the outbox is empty. Server response `accepted: 0` must be
  valid for a telemetry-only payload.
- Between full inventory cycles, send real fresh snapshots and heartbeat
  about every five minutes; keep 30-minute heavy feature collection and
  existing least-privilege/elevated-task boundaries unchanged.
- Only mark local SQLite event rows delivered after verified `status: OK`
  and exact integer acknowledgment count for all submitted rows. Missing,
  partial, malformed or failing responses leave the queue pending for retry.
- Verify these behaviors using isolated behavioral PowerShell mocks in CI,
  including idle queue, success, wrong count, missing ACK, transport errors,
  no destructive UPDATE on failure, and inter-cycle cadence.

## Limitations and operational gates

- Event retries provide **at-least-once**, not exactly-once delivery.
  If an event persists but its response is lost, it may be reinserted by
  the server on retry until an idempotent server-side event key is added.
- Freshness requires an enrolled agent, network, database and a running
  Windows scheduled worker. Measurements can still be stale during long
  full-collection passes, network outages or a stopped process.
- This is not Microsoft Graph/Intune, Jira or external compliance attestation.
- Pending: real customer-managed Windows acceptance, public signed
  Authenticode release, authorized Hostinger VPS/DNS/TLS, production offsite
  MySQL restore and actual SMTP inbox/webhook receipt. No live deployment
  or production certification is claimed.
