# Phase N — Production release acceptance and sign-off

**Status: BLOCKED until independent operator evidence is entered.** Automated main CI is diagnostic; it does not authorize customer deployment or public release.

This runbook applies to the repository's Node.js/Express + MySQL 8 service and Windows agent. Never apply the old PostgreSQL/FastAPI deployment scripts. Never share private credentials in GitHub comments or chat.

## A. Production infrastructure and identity

**Responsible:** Hostinger VPS owner + security/change approver.

- [ ] Confirm a Docker-capable VPS (not ordinary Hostinger shared hosting), ownership, IP, correct actual public DNS A/AAAA record, firewall 80/443 and Caddy trusted TLS. Do not deploy to a placeholder host.
- [ ] Ensure restricted private `Enterprise/.env` exists on the VPS (mode 600), includes cryptographically random unique required secrets, authorized `PLATFORM_ADMIN_USER_ID` and `PLATFORM_OWNER_TENANT_ID`, and is absent from the repository.
- [ ] Before changing running services, run the **read-only** `bash Enterprise/deploy/preflight-stage14.sh --release` against the private environment; do not interpret `--dry-run` as a live success.
- [ ] Run on the authorized VPS: `cd Enterprise/deploy && bash deploy-mysql.sh --host actual.yourdomain.com --dry-run`. After change approval, the VPS operator may run the actual `bash deploy-mysql.sh --host actual.yourdomain.com` and record the deployment SHA, host and incident rollback contact. Existing secrets/database volumes must be preserved.
- [ ] From an independent public network run `bash Enterprise/deploy/verify-hostinger-acceptance.sh --host actual.yourdomain.com`. Confirm HTTPS certificate chain, HTTP redirect, `/healthz` and MySQL HEALTHY. Capture the unredacted HTTP status and a *redacted* certificate/host proof (no credentials).

**Evidence:** host/domain and DNS proof: ______________ · TLS and live health: ______________ · approver/date: ______________

## B. Database restore rehearsal and tenant identity safety

**Responsible:** Database operator. **STOP** on collision, unowned tenant identity or unrecoverable backup.

- [ ] Take an approved, encrypted backup using repository procedure `Enterprise/deploy/backup.sh` plus a separate authorized offsite copy; document backup integrity, timestamp, retention and recovery point.
- [ ] Restore using `Enterprise/deploy/restore.sh` into a **separate disposable production-like environment**, never destructively into the live DB merely to test. Verify tenant/member/device identity uniqueness and no accidental reassignment of historical NULL-owned remediation logs.
- [ ] Confirm migrations `005_remediation_tenant_logs.sql` and `006_notification_outbox.sql` applied once, have expected indexes, and do not expose data across workspaces. Confirm application upgrade and rollback/recovery with the exact backed-up state.
- [ ] Confirm `007_scrub_legacy_github_pat.sql` and `008_scrub_legacy_ticket_keys.sql` applied exactly once; verify no old `branding.github_token` or `ticketConfig.api_key` remains. Capture only **redacted** evidence; never dump secrets into CI logs.
- [ ] Confirm migration `009_notification_destination_binding.sql` adds the outbox destination HMAC. Historic jobs without trustworthy hashes must stay NULL and SKIPPED, not redirected after recipient changes. Plan private HMAC_SECRET rotation deliberately.
- [ ] Confirm migration `010_events_tenant_device_identity.sql` adds nullable tenant/device ownership and index; verify historic event rows remain NULL-owned (no hostname-based reattribution) and tenant APIs read only explicitly owned events.
- [ ] Verify tenant-level ticket metadata and cloud-audit views never imply a real Jira/Graph connector without real provider responses and separate authorization.
- [ ] Perform negative tests: MySQL failure returns fail-closed API, tenant cannot request another tenant's audit logs, processes, patch approvals, remediation or notification status.
- [ ] Record measured restore and recovery times (RTO/RPO); CI disposable MySQL proofs are not substitutes.

**Evidence:** encrypted backup checksum: ______________ · restored-instance ID and validated snapshot: ______________ · RTO/RPO: ______________ · approver: ______________

## C. SMTP and outbound webhook delivery

**Responsible:** Platform operator + authorized tenant SUPER_ADMIN.

- [ ] Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_ALLOWED_RECIPIENT_DOMAINS` privately on the VPS. TLS/STARTTLS with valid certificate is mandatory; credentials must never enter the browser or public repository.
- [ ] Each tenant SUPER_ADMIN separately opts into email/webhook and an approved address or exact HTTPS host; confirm no legacy global destination inherited.
- [ ] Use Alerts test-email to verify SMTP relay DATA 250, **and independently verify actual message in approved recipient inbox with correct headers**; check bounce and suppression. Relay 250 alone is not inbox delivery.
- [ ] Confirm webhook host is in `WEBHOOK_ALLOWED_HOSTS`, TLS and SNI correct, no private-IP DNS redirection, and only the correct workspace's non-sensitive test alert arrives.
- [ ] Review `GET /api/v1/alerts/notifications/status` as tenant SUPER_ADMIN: PENDING/PROCESSING retry behavior, DEAD alerts, and real operations monitoring. Endpoint returns aggregate counts only.
- [ ] Verify retry receiver deduplication expectations. The outbox provides **at-least-once delivery**, not exactly-once or guaranteed inbox placement.

**Evidence:** redacted SMTP certificate and relay test: ______________ · real inbox receipt: ______________ · webhook receiver proof: ______________ · approver: ______________

## D. Publisher-signed MSI and managed Windows hardware

**Responsible:** Release signing officer + Windows endpoint owner.

- [ ] Obtain an authorized public code-signing identity and certificate thumbprint; verify publisher trust and timestamp policy. Signing secrets/keys never enter repository or chat.
- [ ] Manually dispatch a trusted **main-branch CI** run configured for actual signing; require verified signed EXE/MSI artifacts, matching source SHA and release version.
- [ ] After independent publisher/thumbprint verification and release approval, manually use `.github/workflows/publish-signed-installer.yml` with verified source run, exact tag and confirmation, through protected `production-installer` environment. An ordinary push CI diagnostic MSI is **not** a signed release.
- [ ] On physical managed Windows machines, validate UAC, fresh install, enrollment, HTTPS server configuration editing after install, proxy/TLS behavior, uninstall and major upgrade while preserving authorized tenant identity. Repeat with wrong server/unapproved tenant and ensure safe failure.
- [ ] Confirm release hash/installer provenance before permitting customer downloads; record SHA256, Authenticode signer, timestamp and proof of rollback.

**Evidence:** signed source run/tag: ______________ · trusted publisher/thumbprint: ______________ · hardware/UAC/in-place upgrade result: ______________ · approver: ______________

## E. Release decision

| Gate | Current verified status | Human acceptance evidence |
|---|---|---|
| Stage 17 code + diagnostic CI | Accepted: main CI #43981328283 4/4; safety #43981328387 2/2 | GitHub Actions |
| Stage 18 tenant boundaries | **Accepted diagnostic CI:** main #43982225279 SUCCESS 4/4; safety #43982225214 SUCCESS 2/2 | GitHub Actions |
| Stage 19 operator-only release controls | **Accepted diagnostic CI:** main #43988981985 SUCCESS 4/4; safety #43988982034 SUCCESS 2/2 | GitHub Actions |
| Stage 20 truthful ticket/cloud integrations | **Accepted diagnostic CI:** main #43989734105 SUCCESS 4/4; safety #43989734122 SUCCESS 2/2 | GitHub Actions |
| Stage 21 notification destination binding | **Accepted diagnostic CI:** main #44042340512 SUCCESS 4/4; safety #44042340598 SUCCESS 2/2 | GitHub Actions |
| Stage 22 tenant event identity | **Accepted diagnostic CI:** main #44043497516 SUCCESS 4/4; safety #44043497509 SUCCESS 2/2 | GitHub Actions |
| Real Hostinger VPS/DNS/TLS | **BLOCKED** | __________ |
| Authorized production migration / offsite restore | **BLOCKED** | __________ |
| Real SMTP inbox + webhook receiver | **BLOCKED** | __________ |
| Real Jira/ServiceNow/Zendesk API + Microsoft Graph OAuth acceptance | **NOT CONNECTED — CODE/PROVIDER GATE OPEN** | __________ |
| Human-approved signed MSI publication | **BLOCKED** | __________ |
| Physical Windows managed UAC/install/upgrade | **BLOCKED** | __________ |

**Decision rule:** Never label this application *production certified*, publish a signed public MSI, or report live deployment successful until every external gate is independently accepted by an authorized owner. No password, setup token, private key or customer data belongs in this checklist.
