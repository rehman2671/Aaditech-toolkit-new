# Evidence-based feature completion matrix — AadiTech Enterprise

**Baseline:** 2026-11-23 IST, existing `main` = `911f509620029c513305c88b26ca0da4e1b7da37`. PR #75 and #76 are **not on main**. This is a code review/documentation audit, **not** a fresh LAN test. Historical green CI [main #45062353330](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45062353330) has 4/4 jobs including *diagnostic* Windows MSI; safety [#45062353339](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45062353339) 2/2. The later main documentation-only commit has no separate claimed MSI run.

**Legend:** `CI_VERIFIED` = relevant automated code checks passed; `CODE_COMPLETE` = code exists but independent full acceptance evidence absent; `PARTIAL` = basic implementation exists but expected external action/user journey missing; `NOT_STARTED` = target behavior not implemented; `BLOCKED` = external/review prerequisite. **No feature currently has complete independent intranet office E2E + production acceptance evidence in this baseline.**

| ID | Feature / business capability | Existing evidence | Source/readiness | Remaining acceptance |
|---|---|---|---|---|
| FE-01 | Node API, auth and MySQL | `server.js`, `db.js`, `Dockerfile`; MySQL CI | **CI_VERIFIED** | Fresh office host + offline recovery |
| FE-02 | Admin login, RBAC, secure setup key | `server.js` setup/auth, `setup-security.js`, auth tests | **CI_VERIFIED** | Guided installation + first local admin |
| FE-03 | Browser first-run company/admin wizard | `Enterprise/portal/index.html` `renderSetup` and `/api/setup` | **PARTIAL** | Full infrastructure prerequisites and LAN PKI from wizard |
| FE-04 | Users, tenant/workspace identities, invites | `server.js`, `auth-principal.js`, unit/integration MySQL | **CI_VERIFIED** | Separate installation isolation and multi-office E2E |
| FE-05 | Persistent independent installation UUID | Tenant/device identity exists but no proven local installation identity lifecycle | **NOT_STARTED** | Create/backup/clone/restore semantics and tests |
| FE-06 | Agent telemetry enrollment and per-device token | `Agent-Collect.ps1`, `server.js`, enrollment security tests | **CI_VERIFIED** | Physical local endpoint + intranet HTTPS acceptance |
| FE-07 | Windows hardware/software/system inventory | `Enterprise/agent/features.json` (13 existing scripts), `server.js` | **CI_VERIFIED** | Accuracy on mixed office hardware/OS policies |
| FE-08 | Endpoint health, metrics provenance and history | `device-metrics.js`, `security-posture.js`, telemetry migration/tests | **CI_VERIFIED** | Representative devices and privacy policy |
| FE-09 | Events, command queue, signed device commands/ACK | `command-signing.js`, `server.js`, durable MySQL tests | **CI_VERIFIED** | Real offline/online transitions and delivered command outcome |
| FE-10 | Alerts, acknowledge/resolve, notification outbox | `server.js`, `notification-outbox.js`, tests | **CI_VERIFIED** | Locally verified live destinations; SMTP/webhook requires opt-in/config |
| FE-11 | Security posture and update inventory | `security-posture.js`, collectors, posture tests | **CI_VERIFIED** | On-device proof; no real MDM attestation |
| FE-12 | Fleet/device CSV reports and audit logs | `server.js`, portal report/audit views | **CODE_COMPLETE** | Audit retention/redaction and owner acceptance |
| FE-13 | Device groups and tenant policy records | `server.js` `/groups`, `/policies`; UI views | **PARTIAL** | Full policy-to-agent enforcement and precedence tested |
| FE-14 | Patches and approvals | `/api/v1/patches/summary`, `/patches/:id/approve` | **PARTIAL** | Actual endpoint installation/rollback not provided by approval API |
| FE-15 | Predictive health | `device-metrics.js` disk trend, minimum measured sample policy | **PARTIAL** | Calibrated forecast, false positive benchmarking; not trained AI |
| FE-16 | Self-healing commands and policies | `/api/v1/remediation/trigger` queues named remediation | **PARTIAL** | Reviewed `Remediate-*.ps1` scripts + outcome and rollback proof not found |
| FE-17 | Windows diagnostic MSI, agent setup GUI | WiX, `Configure-Agent*.ps1`, Windows main CI | **CI_VERIFIED** diagnostic | Signed approved release; real endpoint install/reconfigure; integrated launch |
| FE-18 | Windows first-run credential ACL hardening (N74) | [PR #76](https://github.com/rehman2671/Aaditech-toolkit-new/pull/76) at `fd0bacf1`; [CI](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45075407395) 3/3 + [safety](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45075407383) 2/2 | **CI_VERIFIED PR ONLY; NOT MERGED** | Independent review; fresh-main diagnostic and real office proof |
| FE-19 | Repo governance/ruleset integrity (N73) | [PR #75](https://github.com/rehman2671/Aaditech-toolkit-new/pull/75) at `67abb1bf`; [CI](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45072083622) 3/3 + [safety](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45072083593) 2/2 | **CI_VERIFIED PR ONLY; NOT MERGED** | Independent review, actual protected main and non-bypass rulesets |
| FE-20 | Public DNS Docker deployment | `Enterprise/deploy/deploy-mysql.sh` / public hostname verifier | **CI_VERIFIED OFFLINE + public-target code** | Real external host acceptance; not required by LAN product |
| FE-21 | Offline LAN one-click server installer | Legacy `deploy.sh`/`deploy.ps1` intentionally block incompatible stack | **NOT_STARTED** | Windows + Linux guided installer, WAN disconnected acceptance |
| FE-22 | Encrypted off-host backup and restore | `backup.sh`, `restore.sh`, isolated MySQL CI | **CI_VERIFIED isolated** | Independent real office encrypted off-host recovery |
| FE-23 | Local support tickets | `server.js` `/api/v1/tickets` | **CODE_COMPLETE** | Workflow E2E; Jira/ServiceNow/Zendesk **NOT_CONNECTED** |
| FE-24 | M365/Azure/Intune integration | `/api/v1/compliance/cloud-audit` responds `NOT_CONNECTED` | **NOT_STARTED external** | Real OAuth/Graph connectors, tenant permissions, consent |
| FE-25 | Windows/Office license compliance | `/api/v1/license/compliance` returns `UNKNOWN/NOT_CONFIGURED` | **PARTIAL/UNKNOWN** | Verified compliance evidence and human policy mapping |
| FE-26 | 26 user troubleshooting and safe repair outcomes | Initial PowerShell diagnostics exist; no shared issue/verified outcome lifecycle | **NOT_STARTED as product** | See `TROUBLESHOOTING-AUTOHEALING.md` |
| FE-27 | Optional central installation registry/service | `tool.aaditechs.in` is a proposal, not existing core | **NOT_STARTED / OPTIONAL** | Design approval, no local availability dependency |
| FE-28 | Public signed release/HSM and human approvals | Workflow/gates exist; GitHub releases empty, main unprotected | **BLOCKED** | Certified signer/HSM, independent review, protected main, approved artifact |

## Original master requirements not yet accepted

[34-section original requirements crosswalk](ORIGINAL-REQUIREMENTS-TRACEABILITY.md) preserves these mandatory features:

| ID | Original feature | Status / remaining proof |
|---|---|---|
| FE-29 | Windows/macOS/Linux agents | **PARTIAL**; Windows only; PR-015, DEC-002 |
| FE-30 | In-platform tenant/group/policy-specific **signed MSI builder** | **PARTIAL** diagnostic generic MSI; PR-016, DEC-003 |
| FE-31 | Weighted 0–100 configurable device health score | **NOT VERIFIED**; PR-018 |
| FE-32 | Complete hardware/network/GPU/battery/process timeseries and 1h/24h/7d/30d charts | **PARTIAL**; PR-017 |
| FE-33 | Process/app usage/crash/foreground/network monitoring | **PARTIAL**; PR-023 |
| FE-34 | CSV/Excel/PDF plus scheduled reports | **PARTIAL** CSV; PR-021 |
| FE-35 | Complete agent service/tamper/update lifecycle, sites, policies and device asset history | **PARTIAL**; PR-019, PR-020, PR-027 |
| FE-36 | Platform SLO/queue/worker/MSI health, HA/backpressure | **PARTIAL**; PR-022 |
| FE-37 | Go/PostgreSQL directive vs Node/MySQL source | **BLOCKED: owner DEC-001** |

## Critical truthfulness bug found in cloud/security dashboard

| ID | Evidence | Risk and required remediation |
|---|---|---|
| FE-38 | `Enterprise/portal/index.html` lines 2114–2118 hard-code green `Active`, `Enrolled`, `Encrypted` and `Active` in Cloud Identity Audit cells; `server.js` `/api/v1/compliance/cloud-audit` reports Azure/Intune as `NOT_CONNECTED` | **P0 / release gate failed**. Dashboard misrepresents unknown data as verified security health. Future code PR must render verified field-specific status (neutral UNKNOWN/NOT_CONNECTED on missing data), with regression tests for absent/stale/null evidence. This docs PR DOES NOT FIX the dashboard. |

**Dedicated follow-up:** [Issue #78 — false-positive cloud/security health badges](https://github.com/rehman2671/Aaditech-toolkit-new/issues/78). Unlike the stack choice, this P0 frontend truthfulness bug can be corrected in its own reviewed code PR **without waiting on [DEC-001 issue #79](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79)**.

**Targeted implementation specification:** [FE-38 cloud/security evidence-to-UI contract](FE38-SECURITY-STATUS-RENDERING-CONTRACT.md). Includes summary cards, stale evidence, overall compliance badge, missing sync time, null fields and accessibility; `AT-SEC-05` still fails until source fix.

## Live governance snapshot (not a durable approval)

On 2026-11-23 live checks returned **`main.protected=false`**, **0 effective rulesets**, **0 releases**, **0 reviews** for #75 and #76. These are time-sensitive; always re-query before production. [Production blocker #62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62) remains OPEN.

## Important truth corrections

- `docs/assessment/FEATURE-STATUS.md` historically lists route names such as `/api/v1/software/inventory`, `/api/v1/compliance/licenses` and `/api/v1/cloud/integrations`; the actual audited routes in current `server.js` are `/api/v1/software/search`, `/api/v1/license/compliance` and `/api/v1/compliance/cloud-audit`. Do not treat stale endpoint references as test evidence.
- External support ticket creation in backend explicitly reports `external_sync: NOT_CONNECTED`.
- Patch approval updates a database status; it does not install Windows KBs.
- A command queue ACK is not successful repair, and a successful MySQL backup CI test is not a customer's restore.
- `project-progress.json` 100% is **only historic audit closure**, never overall product completion.

## Reporting rule

For each feature record **code state, merged branch, CI commit/run, E2E site/date/operator, production signer/release and last independent review**. Never invent completion percentages from file or route counts. The [delivery tracker](DELIVERY-TRACKER.json) records prioritized next actions.

## Phase O — integration evidence checkpoint (2026-11-24 IST)

[PR #109](https://github.com/rehman2671/Aaditech-toolkit-new/pull/109) exact tested head `7b4a0ebf2b65eb638d0e2da7a0b1aa6bbb72601a`: [CI](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45447219419) **4/4 executed jobs PASS** (PowerShell, Node/Vitest, real MySQL API, unsigned Windows MSI integration) and [deployment safety](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45447219513) **2/2 PASS**. Actual EXE/MSI build, extraction, install/uninstall and major upgrade with a disabled legacy task fixture and tenant/device/SQLite preservation. Protected signing skipped. No independent review, main merge, physical LAN acceptance or signed publication.

Historical #2 agent-trust review: the JS verifier accepted coercible fields and could throw for MAC-valid JSON null. Follow-up patch adds typed signature/device-key/clock and envelope checks and MAC-valid malformed-input regressions. Helper boundary only, not proof of Windows runtime or full historical #2/#4/#61 reconciliation. Fresh exact-head CI required. DEC-001 through DEC-005 remain owner decisions; no stack change or production approval inferred.
