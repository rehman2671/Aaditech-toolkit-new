# Phase N Stage 16 — Tenant inventory/operational isolation and SMTP delivery

**Production remains blocked.** This stage first closes cross-workspace inventory/report data leaks before any multi-tenant roll-out.

## Inventory isolation
- Software search/export, license compliance/export, fleet CSV, security posture and predictive analysis now read devices with an explicit authenticated `tenant_id` SQL predicate.
- These routes reject a missing authenticated tenant instead of querying the global fleet.
- Manual remediation now verifies ownership of the selected hostname's device **before** writing a log or queueing a command. Cross-tenant hostnames receive a 404, not a simulated success.
- Legacy system-wide `/metrics` remains platform-wide operational counters only and is not a tenant resource.

## Remaining external acceptance
- SMTP opt-in needs actual private relay settings and a controlled real recipient acceptance test.
- Human-approved signed public Windows MSI, physical Windows tests, actual Hostinger DNS/TLS/backup+restore and production migration/recovery remain independent gates.
