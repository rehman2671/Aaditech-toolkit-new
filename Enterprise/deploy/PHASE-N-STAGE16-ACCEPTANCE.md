# Phase N Stage 16 — Tenant inventory/operational isolation and SMTP delivery

**Stage 16 CODE/CI ACCEPTED; production rollout remains BLOCKED.** Main [CI #43976367121](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43976367121) completed 4/4 mandatory jobs successfully (Node/Vitest, PowerShell, real isolated MySQL/API, diagnostic Windows EXE/MSI install/uninstall/major upgrade). Main [deployment-safety #43976367102](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43976367102) passed 2/2 jobs. Automated proof is not a real relay/inbox test, protected publisher-signing approval or live Hostinger deployment.

## Inventory isolation
- Software search/export, license compliance/export, fleet CSV, security posture and predictive analysis now read devices with an explicit authenticated `tenant_id` SQL predicate.
- These routes reject a missing authenticated tenant instead of querying the global fleet.
- Manual remediation now verifies ownership of the selected hostname's device **before** writing a log or queueing a command. Cross-tenant hostnames receive a 404, not a simulated success.
- Legacy system-wide `/metrics` remains platform-wide operational counters only and is not a tenant resource.

## Remaining external acceptance
- SMTP opt-in needs actual private relay settings and a controlled real recipient acceptance test.
- Human-approved signed public Windows MSI, physical Windows tests, actual Hostinger DNS/TLS/backup+restore and production migration/recovery remain independent gates.

## Email relay implementation and safety (code acceptance pending)

- Real SMTP submission is implemented in `smtp-alerts.js` using Node's `tls` and `net` transport: implicit TLS or mandatory STARTTLS, validated TLS certificates, AUTH PLAIN **only after encryption**, command timeouts, and relay DATA 250 acknowledgement.
- Operator keeps `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` and exact `SMTP_ALLOWED_RECIPIENT_DOMAINS` in private `Enterprise/.env`, passed into the API service by Compose. No tenant can choose the SMTP server or read SMTP credentials.
- Tenant SUPER_ADMIN uses `GET/PUT /api/v1/alerts/email` to opt in with an operator-approved recipient. Only `tenant:<tenantId>:emailConfig` is persisted. By default, alerts send **no email** and do not inherit global retention notification addresses.
- `POST /api/v1/alerts/test-email` returns 400 without tenant opt-in, 503 without configured operator transport, 502 for relay failure, and 200 `ACCEPTED_BY_SMTP_RELAY` **only after the SMTP relay accepts DATA**. Relay acceptance is not inbox delivery; bounced mail and real mailbox receipt must be checked externally.
- The setup wizard no longer collects SMTP passwords that its original backend silently discarded. Post-setup portal offers per-tenant recipient/consent/test controls.
- New tests verify missing credentials, forbidden plaintext SMTP, domain allowlist, CRLF injection, tenant isolation, no sending without consent, and API RBAC. No CI test can assert actual external SMTP certificate/trust, deliverability or recipient inbox arrival.

**Important follow-up:** alert email is best-effort, not persisted in an outbox. This phase does not yet include dead-letter handling, retries, bounce tracking, guaranteed delivery or network-rebinding detection for webhooks. These require separate operational acceptance.

## Verified Stage 16 evidence (2026-11-17)

- [Pull request #6](https://github.com/rehman2671/Aaditech-toolkit-new/pull/6) was squash-merged to main after clean PR [CI #43975986561](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43975986561) and [deployment-safety #43975986567](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43975986567).
- Main merge commit: `7904ebb73333bb310c43a1be3ed4be58f9d53e97`.
- [Main CI #43976367121](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43976367121): **SUCCESS 4/4**, including Windows EXE/MSI diagnostic packaging, MSI install/uninstall and major-upgrade rehearsals.
- [Main deployment-safety #43976367102](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43976367102): **SUCCESS 2/2**, offline deployment safety and disposable MySQL backup/restore.
- **Still NOT accepted for production:** a human-approved and independently verified Authenticode-signed public MSI, real Hostinger VPS/DNS/TLS, approved production data migration and offsite restore rehearsal, physical managed Windows UAC/upgrade/configuration, and an end-to-end SMTP relay certificate and actual customer inbox receipt. The SMTP service is deliberately disabled until operator credentials/domain policy and workspace opt-in are configured.
