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
