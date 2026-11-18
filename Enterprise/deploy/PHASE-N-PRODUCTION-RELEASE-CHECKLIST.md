# Phase N — Production release acceptance and sign-off

## Stage N32 — physical agent local ACK evidence and redacted SHA256 provenance (CODE/CI ACCEPTED; CUSTOMER PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #23](https://github.com/rehman2671/Aaditech-toolkit-new/pull/23) merged at `022cdf78c2c69946b860a9cfaeb97f3e53f29318`. [Main CI #44277910476](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44277910476) **SUCCESS 4/4**; [main safety #44277910495](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44277910495) **SUCCESS 2/2**. Windows job log explicitly confirms **N32 PASS** for real SQLite offline/recovered SHA256 evidence and bundle across a genuine diagnostic MSI upgrade, using **synthetic local ACK only**. Public signed artifact upload **SKIPPED**.

- [x] Windows operator collector requires explicit offline/reconnect attestations. It only reads installed SQLite; it never disconnects network, triggers the agent, reads credentials, mutates outbox rows, or reports actual server ACK without independent evidence.
- [x] CI test proves consent missing, missing queue, report overwrite and tampered payload/queue evidence are rejected.
- [x] Real diagnostic Windows MSI test exercises N32 Offline snapshot before major upgrade, queue survival, synthetic local-ACK state, Recovered snapshot and redacted SHA256 manifest against actual bundled sqlite3.exe.
- [x] After PR/main checks are green, synchronize acceptance and release ledgers with genuine workflow links; do NOT equate simulated local-ACK CI with a real network failure.
- [ ] Operator-authorized physical enrolled customer Windows and real DNS/TLS must show offline interruption followed by eventual local ACK; independent authorized MySQL receipt query must confirm scoped batch receipt and event count.
- [ ] Real production offsite MySQL restore/migration, public publisher-signed MSI and external SMTP/webhook/Graph/ITSM integrations remain separate approval gates.

## Stage N31 — read-only deployment/Windows preflight and independent public release pins (CODE/CI ACCEPTED; CUSTOMER PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #21](https://github.com/rehman2671/Aaditech-toolkit-new/pull/21) merged at `6874e72f2faf9499b4d584b8852781a111b092da`. [Main CI #44193878515](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44193878515) **4/4 SUCCESS**; [main safety #44193879125](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44193879125) **2/2 SUCCESS**. Public signing and signed-artifact upload **SKIPPED**.

- [x] N31 synthetic/offline CI verifies `preflight-stage31.sh --env-file PRIVATE_ENV --report-file NEW_JSON`, safe permissions and redacted report. **Actual production env not yet supplied or tested.**
- [ ] Real Hostinger public TLS/redirect/MySQL check only after operator explicitly passes `--live --confirm-live PROBE_PUBLIC_HEALTH`. No host/domain is assumed before deployment.
- [x] Windows CI negative fixture verifies `Test-CustomerWindowsAcceptance.ps1` blocks unconfigured machine, redacts secrets and avoids live GET by default.
- [ ] Run that same collector on a real customer Windows device and separately verify actual HTTPS, enrollment, NETWORK SERVICE and SQLite queue.
- [x] Publication workflow requires manual `approved_source_sha`, independent `approved_msi_sha256`, approved publisher pin, trusted timestamp, signed embedded EXE and new tag. Negative CI fixtures reject malformed/mismatched inputs.
- [ ] Actual approved public Authenticode EXE/MSI signing, publisher/CA verification and GitHub Release publication require separate human approval.
- [x] CI regression proves offline tests, unsigned/mismatched publisher checksum rejection and unconfigured Windows reports BLOCKED without network activity.
- [ ] On actual Hostinger VPS: approve private env, DNS/TLS ownership, encryption, production migration and offsite MySQL restore. **NOT YET VERIFIED.**
- [ ] On real customer Windows: verify offline ACK-loss/retry under NETWORK SERVICE and trusted publisher MSI installation. **NOT YET VERIFIED.**
- [ ] Protected manual release approval, public Authenticode-signed MSI publication and live SMTP/webhook/Graph/ITSM integrations. **NOT YET VERIFIED.**

## Stage N30 — real MSI pending SQLite queue + safe receipt cleanup (CODE/CI ACCEPTED; CUSTOMER PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #20](https://github.com/rehman2671/Aaditech-toolkit-new/pull/20) merged at `3aa28aee3061f5b70ee81dca9b6460f67837e6ac`. [Main CI #44190267130](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44190267130) **4/4 SUCCESS**, including actual SQLite in-flight queue + exact JSON preservation across real Windows major upgrade 1.1.2001 -> 1.1.2002; [main safety #44190267337](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44190267337) **2/2 SUCCESS**. Signed public MSI upload skipped.

- [x] On main CI, real Windows diagnostic MSI major upgrade verifies installed sqlite3.exe, ProgramData queue.sqlite3 integrity, persistent queue UUID, two pending rows and exact original pending JSON before/after upgrade.
- [x] Isolated MySQL verifies migration 015, 400-day active receipt still dedupes, dry-run default, 180-day minimum, bounded deletion and absent-tenant/zero-device owner guards.
- [x] Confirm main Node/Vitest, PowerShell, API/MySQL, Windows MSI and safety results before code/CI acceptance.
- [ ] Production customer backup/offsite restore, real Windows NETWORK SERVICE and offline ACK-loss, Hostinger VPS/DNS/TLS, public signed MSI, real SMTP/webhook, Graph/ITSM integrations remain separately pending.

## Stage N29 — atomic keyed telemetry request replay (CODE/CI ACCEPTED; PRODUCTION BLOCKED)

**Evidence (2026-11-18 IST):** [PR #19](https://github.com/rehman2671/Aaditech-toolkit-new/pull/19) merged as `5de1def715f02b7494c7c0dc1c7585cf6d1aee94`. [Main CI #44186527404](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44186527404) **4/4 SUCCESS**, including genuine Windows diagnostic MSI install/uninstall/upgrade; [main safety #44186527011](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44186527011) **2/2 SUCCESS**. Public signed artifact upload skipped.

- [x] PR/main CI verifies migration 014, 16-way direct transactional races, 8-way HTTP replay, atomic DB rollback and 409 key-content conflicts.
- [x] Mocked PowerShell canonical Windows worker tests verify byte-identical SQLite JSON replay on lost/partial ACK; matching batch ID/count required.
- [x] Real Windows diagnostic MSI installation/uninstall and major-upgrade preserved server/tenant configuration and enrolled credentials on main.
- [ ] Separate physical pending `queue.sqlite3` file and in-flight `telemetry_outbox` preservation across MSI major upgrade (NOT covered by the existing CI upgrade fixture).
- [ ] Operator-authorized encrypted production MySQL backup/offsite restore and migration 014 rehearsal on actual Hostinger target.
- [ ] Physical Windows enrollment/NETWORK SERVICE/offline retry, public signed Authenticode MSI and real DNS/TLS/SMTP/Graph/ITSM acceptance. **NOT YET VERIFIED.**
- [ ] Keyed batch DB writes are atomic only inside local InnoDB. Actual delivered SMTP/webhook requests are **at-least-once**, not exactly-once.

## Stage N28 — authenticated event retry dedup (CODE/CI ACCEPTED; PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #18](https://github.com/rehman2671/Aaditech-toolkit-new/pull/18) merged at `061694329e98e789af362545e9afe5806508fb6c`; [main CI #44181875110](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44181875110) **4/4 SUCCESS** including authentic Windows diagnostic MSI build/install/upgrade; [main safety #44181875324](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44181875324) **2/2 SUCCESS**. This is **not** a signed public release.

- [x] Verify PR Node/Vitest, PowerShell ACK+queue identity tests, real MySQL 24-way dedup concurrency, Windows diagnostic MSI on main and deployment safety.
- [ ] Supervised migration 013 after authorized encrypted offsite MySQL backup and restore.
- [ ] Customer-enrolled physical Windows ACK-loss replay, reinstall fresh queue and upgrade preserving original identity.
- [ ] Public signing, Hostinger/DNS/TLS, live SMTP/webhooks and third-party connections separately blocked. No full HTTP/alert exactly-once claim.

## Stage N27 — idle-device metrics cadence and outbox ACK safety (CODE/CI ACCEPTED; PRODUCTION BLOCKED)

**Automated accepted (2026-11-18 IST):** [PR #17](https://github.com/rehman2671/Aaditech-toolkit-new/pull/17), [main CI #44173643947](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44173643947) **4/4 SUCCESS** including genuine Windows diagnostic MSI install/uninstall/upgrade, [main safety #44173643755](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44173643755) **2/2 SUCCESS**. Signed artifact upload was **SKIPPED**.

- [x] Verify PR Node/Vitest, behavioral PowerShell agent tests, real MySQL/API and safety CI; merge and verify genuine diagnostic Windows EXE/MSI pipeline on main.
- [ ] With a properly enrolled physical Windows MSI agent, monitor a device with no queued collector events for at least 30 minutes: measured CPU/RAM/disk must refresh at about five-minute intervals without rerunning full inventory or privileged collectors.
- [ ] Deny outbound HTTPS, return malformed/partial ACK responses in a controlled environment and verify pending SQLite events remain retryable. Verify successful server ACK marks exactly the local rows delivered; retries are at-least-once (not deduplicated exactly-once).
- [ ] Recheck the 15-minute tenant telemetry freshness policy, legitimate zero values and real notification behavior. No acceptance without genuine customer devices and independent evidence.
- [ ] All public signer, Hostinger VPS/DNS/TLS, offsite customer MySQL recovery, live SMTP/webhook and independent Graph/Jira acceptance gates remain **BLOCKED**.

## Stage N26 — canonical MSI-agent telemetry (CODE/CI ACCEPTED; PRODUCTION BLOCKED)

**Automated accepted (2026-11-17):** [PR #16](https://github.com/rehman2671/Aaditech-toolkit-new/pull/16);
[main CI #44148317301](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44148317301) **SUCCESS 4/4** including diagnostic Windows MSI and [main deployment-safety #44148317186](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44148317186) **SUCCESS 2/2**. Public artifact signing/upload deliberately skipped.

- [x] Verify CI (Node/Vitest, PowerShell, real MySQL and diagnostic Windows MSI) on PR and merged main.
- [ ] On an authorized physical Windows MSI install, confirm canonical Agent-Collect.exe reports fresh CPU, RAM, system-drive free disk, BitLocker, Defender and firewall state to the enrolled workspace.
- [ ] Under a collector-denied account, prove unavailable values remain NULL or UNKNOWN, and replayed outbox events are not promoted to current measurements.
- [ ] Verify genuine 0 GB free disk can alert but missing/null measurements never trigger low-disk notifications.
- [ ] Secure Boot, local-admin membership and cloud compliance remain unverified. Production Hostinger, public MSI signing, offsite restore, actual inbox/webhook and customer UAC gates remain BLOCKED.


## Stage N25 measured device telemetry and real-inventory acceptance

**Automated CODE/CI accepted (2026-11-17):** [PR #15](https://github.com/rehman2671/Aaditech-toolkit-new/pull/15), [main CI #44068596639](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44068596639) **4/4 SUCCESS** including diagnostic Windows MSI, [main safety #44068596502](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44068596502) **2/2 SUCCESS**. Customer/production evidence checkboxes remain unchecked.

- [ ] Back up the authorized production MySQL database and rehearse full offsite recovery before applying `012_measured_device_telemetry.sql`. Historic default usage must stay unverified until genuine enrolled-device reports.
- [ ] On customer-managed Windows, verify a never-connected registration shows no CPU/RAM/disk/battery values, and a collector failure reports NULL, not fabricated success. Validate real measured 0%, partial and stale snapshots.
- [ ] Verify processes and app-usage display `NOT_REPORTED` without current agent evidence; validate real MySQL process INSERT `updated_at` and that an unplugged/offline device's cached activity expires within 15 minutes.
- [ ] Verify prediction requires measured samples over at least one hour and that a NULL disk forecast never presents a cleanup action; require operator approval for any actual remote remediation.
- [ ] Rehearse diagnostic Windows EXE/MSI upgrade on physical devices, then obtain separate authorized public Authenticode signer approval and Hostinger customer production sign-off.


## Stage N24 genuine posture collection and customer evidence

**Automated code/CI accepted (2026-11-17):** [PR #14](https://github.com/rehman2671/Aaditech-toolkit-new/pull/14), [main CI #44065258102](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258102) **4/4 SUCCESS** including diagnostic Windows MSI, [main safety #44065258073](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258073) **2/2 SUCCESS**. Live production acceptance remains BLOCKED pending operator evidence.

- [ ] Obtain authorized production DB backup and independently verified offsite restore before applying `011_security_posture_provenance.sql`; confirm historical `posture_reported_at` remains NULL rather than inferring health from old defaults.
- [ ] Upgrade actual managed Windows agents with the corrected collector; verify BitLocker/Defender/firewall explicitly report UNKNOWN on collector failure and healthy only when observed, without physical test data in Git logs.
- [ ] Recheck security posture and cloud audit with fresh measured/unknown/stale states for multiple enrolled customer devices; ensure `secure_boot` and `local_admins_count` remain unverified until genuine collectors/attestation are implemented.
- [ ] Obtain independent customer/MDM approval for any external compliance claim. Device-reported status does not prove Microsoft Graph/Intune connection or third-party attestation.


## Stage N23 command control and external acceptance

**Automated code/CI acceptance confirmed (2026-11-17):** [PR #13](https://github.com/rehman2671/Aaditech-toolkit-new/pull/13), [main CI #44054232799](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232799) **4/4 PASS** including diagnostic Windows MSI rehearsal; [main safety #44054232802](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232802) **2/2 PASS**. Operator/production checkboxes below remain deliberately unchecked pending customer evidence.

- [ ] Confirm only credential-verified enrolled devices can claim commands via atomic conditional MySQL updates; no parallel API process can distribute the same PENDING command twice.
- [ ] Confirm write outages return HTTP 503 (not fabricated queued success); command completion and duplicate result status are SQL-acknowledged and recorded once.
- [ ] Treat lost agent result for an IN_PROGRESS reboot/script as **unknown execution outcome** requiring human investigation. Never auto-requeue destructive commands without verified device-side exactly-once controls.
- [ ] Repeat the acceptance on a real enrolled device under customer-approved policies; GitHub workflow signatures and ephemeral MySQL evidence do not substitute for signed production release.


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
