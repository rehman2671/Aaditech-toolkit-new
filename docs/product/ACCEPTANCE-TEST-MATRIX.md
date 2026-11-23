# Enterprise acceptance test matrix — product release gates

**All tests marked PENDING unless explicitly distinguished as existing isolated CI.** ACI = automatically collected CI; W = independently witnessed physical/real test. External approvals cannot be simulated.

| Test | Priority | Must demonstrate / evidence required | Current evidence/status |
|---|---|---|---|
| AT-LAN-01 | P0 | Fresh supported Windows Server install: single launcher, preflight, private DB, local HTTPS, first-run admin, no hand-edited secrets | **PENDING**; legacy Windows deploy intentionally incompatible |
| AT-LAN-02 | P0 | Fresh supported Linux server install in intranet mode with no public DNS or WAN | **PENDING**; current MySQL deploy expects public hostname |
| AT-LAN-03 | P0 | Physically disconnected internet after install: UI, login, MySQL, 2+ agent enrollments, telemetry, command ACK, dashboard, local reporting all work | **PENDING** |
| AT-LAN-04 | P0 | Windows 10/11 agent MSI/CLI/GUI with trusted internal cert, UAC, tenant token, reboot, reconfiguration and GPO/manual enrollment; no trust bypass | **PENDING physical**; diagnostic Windows CI exists |
| AT-LAN-05 | P0 | Two separate office installations have distinct persistent installation UUIDs and cannot read/share any device or tenant secrets | **PENDING**; independent installation ID not implemented |
| AT-LAN-06 | P0 | Upgrade and preserve data, identity, agent schedule, policy, certificates; rollback or safe stop after interruption | **PENDING physical**; isolated MSI major-upgrade CI exists |
| AT-LAN-07 | P0 | Intermittent LAN, hostname change, service restart and lost-ACK retry do not duplicate accepted data or leak credentials | **PENDING real LAN**; synthetic MySQL fault tests exist |
| AT-SEC-01 | P0 | Internal CA or enterprise PKI trust, hostname SAN verification, invalid/expired/untrusted cert fail closed | **PENDING LAN**; existing public-TLS checks not equivalent |
| AT-SEC-02 | P0 | OS ACLs on setup/agent/database secrets; no printed/embedded shared tokens; approver and user policy enforced | **PENDING physical**; N74 PR CI passed, not merged |
| AT-SEC-03 | P0 | Cross-tenant/cross-installation/duplicate hostname/UID enrollment, commands and reports refused under race and restore | **PENDING multi-office**; isolated tenant tests exist |
| AT-SEC-04 | P0 | Unsafe or unapproved commands disabled; tampered signature/replay/expiry, unreviewed repair scripts denied; audited approvals | **PENDING physical**; signed-command code and unit tests exist |
| AT-OPS-01 | P0 | Approved source, independent reviewer, protected main, release certificate, publisher Authenticode, immutable hash and download | **BLOCKED**; #62, #75, #76 |
| AT-OPS-02 | P0 | Encrypted, physically independent backup export and isolated full restore of an office with identical validated state | **PENDING**; CI MySQL backup/restore 2/2 |
| AT-OPS-03 | P0 | Operator handoff: install, reconfigure, certificate renewal, recovery, support escalation and signed decommission process | **PENDING** |
| AT-TR-01 | P1 | Each issue in 26-type catalog has tested read-only triage, data minimization and invalid input refusal | **PENDING** |
| AT-TR-02 | P1 | Approved low-risk playbook can execute on enrolled Windows endpoint, verify independent postcondition, rollback and record outcome | **PENDING**; queue API alone insufficient |
| AT-TR-03 | P1 | High-risk actions require authorized approval; malware/physical burning/unsafe hardware never silently auto-repaired | **PENDING** |
| AT-TR-04 | P1 | Dashboard incidents reconcile retries, reopened issues, unique users/devices and verified outcomes; denominator published | **PENDING** |
| AT-EXT-01 | P2 | Optional central service can disconnect for 7+ days without blocking local use; no data transfer without opt-in | **PENDING / not a P0 release blocker** |

## Critical status-authenticity gate

| Test | Priority | Required evidence | Status |
|---|---|---|---|
| AT-SEC-05 | P0 | With Azure/Intune disconnected and null/stale BitLocker/Defender telemetry, Cloud Identity Audit shows neutral UNKNOWN/NOT_CONNECTED, **not** static green compliant badges; validate real verified source fields | **FAIL in current UI source** at `Enterprise/portal/index.html` lines 2114–2117; fix and regression pending |

**AT-SEC-05 granular cases:** see [FE-38 status-rendering contract](FE38-SECURITY-STATUS-RENDERING-CONTRACT.md); include neutral `Not connected` summary card tones, `Not verified` overall compliance, stale/unknown rows and no invented cloud sync time. Backend posture unit tests alone do not validate displayed status.

**AT-LAN suite detailed implementation mapping:** see [LAN implementation backlog](LAN-INSTALLATION-IMPLEMENTATION-BACKLOG.md) and [issue #80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80). A public-DNS Docker installation does not satisfy this suite.

## Original-scope sign-off gates

| Test | Original requirement | State |
|---|---|---|
| AT-OR-01 | Windows/macOS/Linux agent parity, secure enrollment, collectors, offline queue | **PENDING** |
| AT-OR-02 | Signed per-tenant/group/policy portal MSI builder, authenticated download, revocation and physical enrollment | **PENDING** |
| AT-OR-03 | Full measured metrics, process/app usage, source/freshness and historical timeseries | **PENDING** |
| AT-OR-04 | Explainable policy-configurable device health score, asset/site lifecycle and fine-grained roles | **PENDING** |
| AT-OR-05 | Scheduled PDF/Excel/CSV reports, platform observability, scale/recovery | **PENDING** |
| AT-OR-06 | Explicit owner ADR deciding original Go/PG vs Node/MySQL stack | **BLOCKED (DEC-001)** |

## Evidence quality

- **ACI isolated:** tests in disposable GitHub Windows runner, local MySQL Docker volume and mocked/synthetic network. Valid for code regression, not customer production.
- **W office:** signed installer hash, supported OS/build, actual office network topology, time, operator reviewer, sanitized config fingerprint, pass/fail plus rollback artifact.
- **Independent release:** security owner's explicit certificate/signing verification and code review, protected branch controls; signed customer approval. No guessed Hostinger URL or certificate.

## Gate owners

| Area | Proposed role | Approves |
|---|---|---|
| Product scope and workflow | Product owner | Requirements, acceptance scenario choices |
| LAN server | IT deployment operator | Host, PKI, recovery, physical install |
| Agent operations | Enterprise desktop admin | GPO/Intune/manual enrollment, real endpoint |
| Security | Independent reviewer/security owner | Privilege model, signer, audit/retention |
| Data recovery | DBA/operator | Encrypted offsite restore witness |
| Troubleshooting | IT support lead | D0-D3 playbooks, consent, success criteria |

Only actual evidence and role approval can change a test to PASS. Documentation adoption alone does **not** modify any gate.
