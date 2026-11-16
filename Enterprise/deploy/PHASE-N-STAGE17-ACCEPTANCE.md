# Phase N Stage 17 — Remediation tenant isolation and pinned webhook DNS

**Status: Code implemented in PR branch; independent CI + production acceptance required.**

## Remediation authorization and historical data safety

- Workspace remediation policies are based on shared *action templates*, but enable/disable overrides are stored only in `tenant:<id>:remediationPolicyOverrides`. Changing policy state in one workspace does not change other tenants' settings.
- A client-provided action is only accepted if it is a known catalog entry and is enabled in that workspace. Previously the fallback generated a script name even for an unrecognized action.
- Remediation log writes require a tenant ID and SQL insert it. Log reads use `WHERE tenant_id = ?`; legacy rows with no trustworthy tenant ID stay NULL and are invisible rather than being inferred from non-unique hostname.
- The schema migration `005_remediation_tenant_logs.sql` conditionally adds `tenant_id` and a per-tenant history index on MySQL 8. Existing baseline schema is updated for fresh database initialization.
- Device ownership is checked before any queue or log action. Queue is now persisted before pending-action log, avoiding a success log for a command that never queued.

## Outbound webhook DNS enforcement

- HTTPS exact host allowlist and default port 443 only; no URL credentials, fragments, IP literals, lookalike host or redirects.
- On delivery, DNS A records are resolved and **all** returned IPv4 addresses must be public, then an outgoing HTTPS request is bound to the previously validated IP. TLS SNI and certificate hostname verification remain bound to the original approved DNS host. No second DNS lookup can send this request to private infrastructure.
- IPv6-only webhook destinations are intentionally refused rather than using unverified IPv6 filtering. Max JSON payload 16 KiB, 5s request timeout, fresh isolated HTTPS connection.
- Reject missing/unapproved DNS, localhost, link-local/cloud metadata IP, RFC1918, carrier-grade NAT, benchmark, documentation, and reserved IPv4 space.

## Acceptance still outstanding

- Real TLS webhook/SMTP endpoint and inbox verification, human-approved signed public MSI, actual Hostinger VPS/DNS/TLS acceptance, authorized production migration + offsite restore, physical Windows UAC/install/upgrade acceptance.
- Alert automatic notifications remain best-effort until a durable outbox has been implemented and tested in the next implementation tranche.

## Durable alert notifications (Stage 17)

- Schema migration `006_notification_outbox.sql` creates an indexed, tenant-owned, unique-per-alert/channel outbox.
- Telemetry alert creation and both notification delivery jobs commit in one MySQL transaction in production. Queue insert errors roll back the alert (not silently swallowed). No SMTP/webhook network send blocks telemetry ingest.
- Multiple PM2 workers claim available jobs with a single atomic `UPDATE ... ORDER BY id LIMIT ?`, followed by reading only their own random lease token. Each claim has a 90-second lease; crash recovery retries expired leases.
- Five bounded attempts with exponential delay; exhausted jobs go to `DEAD` for operator investigation. Permanent disabled/unapproved destinations go to `SKIPPED`. Successful send means SMTP relay acceptance or HTTP 2xx, *not actual user receipt*.
- Worker starts only with the production MySQL-backed server; Vitest/development fixtures do not run background network sends. Terminal records older than 30 days are pruned.
- Tenant SUPER_ADMIN may inspect scoped aggregate counts via `GET /api/v1/alerts/notifications/status`. API never returns payload/recipient credentials via that endpoint.
- Delivery semantics are **at-least-once**; if a worker crashes after the receiver accepted data but before the database marks completion, a retry can deliver a duplicate. Downstream consumers should deduplicate by alert identifier if required.
- A redirection, DNS private-IP response, SMTP failure, MySQL outage, or unauthorized recipient may not bypass the configured allowlist/tenant consent. Live network/inbox acceptance still pending.
