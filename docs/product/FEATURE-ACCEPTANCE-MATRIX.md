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

## Phase O credential authority and acceptance checkpoint (2026-11-24)

[PR #109](https://github.com/rehman2671/Aaditech-toolkit-new/pull/109) prior exact head `41942da70c5c11baf618ad441add9d7c1573b5b7` passed [4/4 executable CI jobs](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45449608007) and [2/2 deployment safety jobs](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45449608037), including unsigned Windows installer lifecycle and typed JS signed-envelope verification. The subsequent combined review candidate incorporates [#110](https://github.com/rehman2671/Aaditech-toolkit-new/pull/110) at `c9128da7a5fbe5c04d60d1663712364735f950ec`: canonical header-only device authentication, unique current token hash authority, tenant-scoped audited revocation, plus a two-process HTTP/MySQL concurrent revocation regression. See the master integration document and delivery tracker for exact evidence and remaining work. New combined head CI pending; rotation/recovery, legacy migration, in-flight cancellation policy, full tenant isolation and physical signed endpoint acceptance remain open. No owner ADR, main merge, independent approval, or production acceptance.


## Phase O revocation verification correction (2026-11-24)

PR #109 exact head ebd4848d826e5bb8e764d95fce701d8a0a794835: Node/Vitest passed and deployment safety #45451309706 passed; CI #45451309686 API fault rehearsal failed at line 214 (401 vs expected 403 after prior revocation/audit/last-seen assertions). Corrected the test to require existing 401 DEVICE_TOKEN_REVOKED contract, retained exact error assertion, added real two-worker legacy/conflicting-header denial tests. Fresh combined CI required; no full revocation or production acceptance yet. Historical unsigned MSI verification remains exact-head evidence; no signer, owner ADR, protected merge or field acceptance.

## Phase O recovery and migration safety checkpoint (2026-11-24)

Exact head 583a7e637d2e3e32cf7612eb7887321ab25b1f48: PowerShell, Node/Vitest and production API/MySQL job SUCCESS (CI 45451912773); deployment safety 45451912586 2/2 SUCCESS; unsigned MSI job still in progress at observation. Production signing skipped.

Recovery preflight implementation: explicit tenant SUPER_ADMIN bearer-only read-only GET by immutable ID, no-store response, persistent database only, categorizes unique/ambiguous/legacy-only/missing/invalid credentials and outstanding commands (including IN_PROGRESS or unknown status), returns blockers and always replacement_allowed=false. No secret/hash returned, no migration, token issuance, mutation or queue cancellation. Added helper/DB regressions and two-production-worker foreign-tenant 404 for revocation/preflight, cookie refusal and pre/post-revocation snapshots. New CI pending; physical recovery, atomic credential replacement, authenticated local handoff, in-flight command policy, legacy migration and independent review still required.

Endpoint: `GET /api/v1/devices/:id/credentials/recovery-preflight`. This is an assessment, not an approval or authorization to rotate credentials; absence of outstanding server commands does not prove no endpoint-side work remains. Revoked devices must not use bootstrap enrollment to overwrite an existing identity. No owner ADR, main merge, signing or production acceptance.

## Phase O command mutation and recovery safety checkpoint (2026-11-24)

Exact head 1b45dad47368b05a90a3b44a5e9fe2c3f40f5905: CI 45452577035 PowerShell, Node/Vitest and real API/MySQL (two-worker cross-tenant revocation/preflight) SUCCESS; deployment safety 45452576922 2/2 SUCCESS. Unsigned Windows MSI still running at observation; protected signing skipped. Previous 583a7e63 MSI cancelled on supersession.

Command mutation fence: deployed claim and terminal result writes now require current tenant/device token hash under the same MySQL device row lock used by revocation, with rollback and fail-closed credential change rejection. New mocked transaction regressions and two-worker HTTP/MySQL claim, result receipt replay, outstanding-command recovery blocker and revoked-result denial rehearsal added. Fresh CI required. Does not cancel or recall a command claimed before revocation, fence every telemetry write or implement credential replacement, rotation or local recovery handoff. Explicit synthetic test compatibility remains.

Lock order is device row first, command row second. A command already claimed can be delivered or run after revocation, and a lost response can leave IN_PROGRESS work; preserve and reconcile it rather than automatically retry or mark it complete. Recovery preflight remains advisory with replacement_allowed=false. Independent review, owner ADRs, protected main, physical endpoint acceptance and signed release remain required.

## Phase O command admission and recovery checkpoint (2026-11-24 IST)

Exact head d5755e1035881675e8e2e7923bc7e33bb7d622f3: CI 45453396797 Node/Vitest FAILED (470/473 tests passed; three N23 production-mode fixtures omitted the newly mandatory credential/transaction interface). API job skipped; PowerShell running at observation. Deployment safety 45453396774 2/2 SUCCESS. Previous head 1b45dad4 unsigned MSI was cancelled, not accepted.

N23 fixture reconciliation preserves production fail-closed behavior and exercises device-row lock plus existing CAS, owner and database-failure assertions. Missing credentials now explicitly tested for claim, completion and queue insertion. Command enqueue additionally uses the same device lock and current credential hash as claim/result/revocation, including direct dispatch and policy-approved remediation; stale or revoked targets return HTTP 409 DEVICE_CREDENTIAL_NOT_ACTIVE without inserting a queue row. Mocked regression expanded to enqueue, and isolated two-worker rehearsal asserts revoked dispatch cannot add queue rows. Fresh combined CI required; no cancellation of preexisting or executing commands, automatic recovery or credential issuance.

Recovery authorization and replacement remain blocked pending transaction/telemetry review, independent endpoint ownership proof, durable single-use authorization, atomic Windows credential storage and reconciliation of outstanding work. No owner ADR, main merge, protected signing or production acceptance. The older Windows diagnostic evidence applies only to its exact tested revision.

## Phase O telemetry transaction credential checkpoint (2026-11-24 IST)

Exact head 16c56b54971e76e06dbb64f4ab35a5f3c66bb07a: CI 45454066429 Node/Vitest (including corrected N23), PowerShell and real API/MySQL passed; unsigned Windows MSI job running at observation, protected signing skipped. Deployment safety 45454066314 both jobs passed.

Keyed telemetry and deployed heartbeat now revalidate the current device credential under the same MySQL device-row lock as revocation. Keyed batches acquire the device lock before any receipt claim, including duplicate ACK replay; foreign, missing, ambiguous, changed or revoked credentials fail closed. Added mocked rejection tests, isolated real MySQL credential-fence rehearsal and two-production-worker HTTP heartbeat/batch/replay/revocation assertions. Legacy unkeyed telemetry still follows the compatibility path and requires separate migration/fencing; test-mode compatibility remains explicit. Optional post-commit Redis application-usage caching is not fenced by this transaction. No new recovery authorization, replacement token, rotation or local handoff. Fresh CI required.

Lock order: device row before receipt or command row. Revocation cannot erase previously committed evidence or cancel work already executing. Recovery preflight remains advisory, replacement disabled; finish legacy telemetry compatibility/mutation review and independent endpoint ownership/authorization design before enabling credential replacement. No main merge, architecture approval, protected signing or production acceptance.

## Phase O legacy telemetry and cache admission checkpoint (2026-11-24 IST)

Exact head dc746c3105cdd81be00b8c19596ef17ad12c9cd2: CI 45454627250 PowerShell, Node/Vitest and real API/MySQL succeeded; N29 real transaction rollback/replay/revoked credential fence and two-production-worker rehearsal confirmed in logs; unsigned Windows MSI running at observation, protected signing skipped. Safety 45454627043 both jobs passed. Prior 16c56b54 unsigned MSI cancelled on supersession.

Deployed canonical and legacy ingest aliases now require batch_id after enrolled-device authentication; unkeyed compatibility path is explicit test-mode only. Legacy standalone script generates per-sample batch ID, checks receipt and stops accepting response-issued replacement credentials; it does not gain the installed MSI worker's durable outbox or restart retry guarantees. Redis app usage now uses an opaque tenant/device/current-credential namespace; deployed readers re-resolve authoritative unique active credential before and after Redis access and never fall back to old keys; stale writes remain in old expiring namespaces, not current live evidence. Same-generation ordering and cross-store atomicity are not guaranteed. Added unit, source and two-worker HTTP regression coverage. Existing unkeyed deployed clients must upgrade; no fleet rollout or actual live Redis acceptance claimed. Fresh CI required; recovery authorization, credential replacement and local handoff remain disabled.

Migration: update legacy clients before deploying the new server contract; the canonical installed agent already uses a durable keyed outbox. Both aliases reject authenticated unkeyed writes with HTTP 400 TELEMETRY_BATCH_ID_REQUIRED. Old Redis app_usage keys expire and are not read by deployed v2 code; future credential replacement must never reuse a prior token. The app usage cache remains optional, not durable proof of freshness or recovery. No owner ADR, main merge, independent approval, signing or production acceptance.

## Phase O command quarantine / recovery prerequisite reconciliation (2026-11-24 IST)

Exact master a0848795fdff741c05c44d9542385b8959f3e801: CI 45456389754 Node/Vitest succeeded; PowerShell and API/MySQL running at observation. Safety 45456389385 both jobs passed. Previous 116413a9 API regression from unkeyed synthetic tenant fixture was corrected in a0848795; fresh full API acceptance remains required.

Selectively reconciled #111 source 5ecd18c1939db92cb187e7721e6d95bb898c6eca command quarantine and previously revoked device reconciliation into master without importing conflicting unkeyed ingestion or migration 016. First revocation atomically cancels only PENDING rows with all pickup/execution/completion timestamps null, audits exact count, retains read-only idempotent retry. Explicit tenant SUPER_ADMIN bearer-only POST /api/v1/devices/:id/credentials/reconcile-pending requires immutable ID confirmation and fixed action CANCEL_NEVER_CLAIMED_PENDING; revoked devices only, remaining outstanding count, audit only on change, replacement_allowed=false. Source unit coverage and two-worker regression integrated; additional active-device 409 and suspicious pending-with-pickup-evidence preservation tests. No in-flight cancellation or credential issuance. Fresh CI required.

Decision for integration: retain master mandatory batch ID and current credential-generation Redis isolation. #111's persistent usage snapshot migration 016 and its alternative deployed unkeyed ingestion remain unintegrated and require separate conflict-aware review; source PR is retained, not merged wholesale. Already claimed or uncertain work remains a recovery blocker. Durable single-use recovery authorization requires independently verified endpoint ownership and owner DEC-003 policy before live issuance; no automatic migration or replacement, main merge, signing or production acceptance.


## Phase O exact-head verification and coverage recovery (2026-11-24)

Master #109 exact head 1c90d4492ecb8f192c28203bac502f772549651f CI #45456930486 4/4 executed SUCCESS (Node, PowerShell, real MySQL API, unsigned Windows MSI); deployment safety #45456930417 SUCCESS. Protected signed build skipped. #111 exact b1ff5176 CI #45457267890 all 483 tests/74 files passed, but statement coverage 69.73% below unchanged 70% threshold; API skipped. Added focused snapshot read/write, explicit empty/absent, duplicate receipt, invalid data, credential, rollback and DB-unavailable tests without reducing coverage gate. Fresh CI required; migration 016 staging backup/restore and physical source acquisition pending. Master quarantine/reconciliation verified at prior exact head, replacement issuance/independent ownership and secure handoff remain blocked.


## Phase O signed recovery evidence boundary (2026-11-24)

Exact #111 e91cd7b1 CI #45458222144 Node/Vitest passed 489/489, statement coverage 71.07% (unchanged 70% threshold), API/PowerShell running at observation. Added review-only Ed25519 recovery evidence verifier, with independently supplied payload and reviewer SPKI pins, canonical bounded JSON, exact tenant/device/request/challenge/current credential fingerprint, <=5-minute trusted-clock validity and separate ownership/reconciliation/local-handoff evidence digests. Negative tests cover tamper, mismatched context, malformed/noncanonical evidence, expiry, and signature/key pins. Verifier is deliberately not wired to HTTP issuance or DB mutation; does not certify referenced evidence, consume grants, or authorize replacement. Durable one-use CAS, reviewer custody and independent endpoint ownership, uncertain command resolution and atomic Windows handoff remain required. Fresh CI required; production not accepted.

## Phase O master application usage and signed recovery evidence integration (2026-11-24 IST)

Exact integration head 1c90d4492ecb8f192c28203bac502f772549651f: CI 45456930486 all four executable jobs passed (PowerShell, Node/Vitest, real API/MySQL, unsigned Windows MSI lifecycle); protected signed MSI skipped. Deployment safety 45456930417 both jobs passed. Exact source #111 e91cd7b1 CI 45458222144 PowerShell, Node/Vitest (489/489, 71.07% statement coverage with unchanged 70% threshold), API/MySQL passed; unsigned and signed MSI jobs skipped. Newer source 6240cf59 fresh CI 45458699873 running at observation.

Integrated exact #111 source 6240cf591c17b27104ac986dbc1d4d1ab982f335 code/migration/test blobs after verifying its merge base equals master 1c90d449. Migration 016 adds bounded one-per-device credential-bound application usage snapshot committed with keyed telemetry; authoritative tenant/current-credential/15-minute freshness read, explicit empty versus not reported, no deployed Redis fallback or historical Redis import. Master keyed-only admission and command quarantine/reconciliation preserved. Integrated review-only Ed25519 recovery-evidence verification helper with pinned artifact digest, reviewer key, request/device/tenant/challenge/current generation and bounded clock, plus negative tests. No HTTP admission, durable grant consumption, evidence truth certification or credential issuance. Fresh combined CI and staging encrypted migration backup/restore rehearsal required. Windows agent app usage collector, independent endpoint proof, durable single-use authorization and physical local handoff remain incomplete.

Source PR #111 is retained as review history. Existing Redis-only evidence is deliberately not backfilled; snapshot payload bounded to 100 records and 64 KiB, stale/revoked/rotated evidence must not appear live. Source snapshot verification is not production deployment acceptance. No approval of DEC-003, independent security review, main merge, live credential replacement or protected signing.


## Phase O durable review reservations (2026-11-24)

Master #109 87e6a504 CI #45458997023 Node passed, API failed in identity-concurrency child process exited before reporting result (0); safety #45458997283 passed. IPC harness now awaits send completion and observes close instead of exit, without weakening race assertions. Source #111 6240cf59 CI #45458699873 all three executed jobs passed. Migration 017 adds persistent review-only requests and one-time signed review reservations (not activation grants), with revoked unique current credential, no unresolved commands, active persisted SUPER_ADMIN, distinct requester/reviewer, DB clock, same device-row lock, exact pins, pending-state CAS and atomic audit. Mock negative coverage and isolated real MySQL concurrent request/reservation test added. No HTTP route, grant consumption, credential issuance, independent key custody or endpoint proof; staged migration/backup, actual ownership, uncertain-command resolution and secure Windows handoff remain required. Fresh combined CI required; production not accepted.


## Phase O review continuity and predictive integrity (2026-11-24)

Batch on #109 eb959573: CI #45459849750 Node passed, API/PowerShell running at observation; safety #45459849717 passed. Hardened review reservation: immutable pre-await inputs, deterministic persisted requester/reviewer locks and live role checks, independent pins for each of three referenced artifacts, post-lock DB expiry recheck; mock and real MySQL negative cases added. In parallel predictive telemetry now counts distinct timestamp observations, rejects conflicting evidence and revoked devices, preserves disk forecast while missing CPU/RAM yields Unrated/null composite health; focused tests added. No activation grant/HTTP issuance, independent evidence custody or physical ownership claim; no policy-configurable score implementation/ADR approval. Fresh CI required. Production not accepted.

## Phase O parallel endpoint, dashboard and recovery review hardening (2026-11-25 IST)

Exact integration deb6a0981fa7cfd6693f76ca1b21bf1fe8067de1: CI 45460379289 Node/Vitest, PowerShell, API/MySQL completed successfully, unsigned MSI running at observation; protected signing skipped. Safety 45460379259 both jobs passed. Existing FE-38 actual portal rendering tests and combined integration tests executed in passing Node job 138681188625; former DESIGN ONLY/NOT_STARTED tracking was stale.

Parallel security batch: installed PowerShell verifier requires canonical 56-character per-device token, typed outer command ID/signature/content, object JSON envelope, integral version, nonblank typed identity/kind, object payload and bounded parsed issue/expiry clock; rejects MAC-valid coercible values. Native fixture corrected from a 55-character token, expanded regressions and added Windows PowerShell 5.1 CI alongside pwsh. Allowlisted script dispatcher requires scalar script name, separator-bounded canonical root and rejects root/descendant reparse points; isolated harmless CI script and junction regression. Local ACL integrity and concurrent path replacement remain separate physical acceptance gates. FE-38 portal now shows measured BitLocker denominator against fleet and treats fresh negative security field as noncompliance even with contradictory overall label; rendering regression extended. Review-only authorization input now requires exact-length typed tenant/device/request IDs and hashes, rejecting coercible or newline-tailed pins before transaction. No live activation grant or endpoint proof. Fresh combined CI required.

Keep FE-38 blocked for independent review and production acceptance despite existing runtime/CI evidence; historical AT-SEC-05 identifier is also used for command-result recovery, so do not overwrite that distinct tracking row. No owner ADR, credential issuance, protected signing, main merge or physical acceptance. Remaining: independent evidence custody, durable activation authority, endpoint local handoff, real application usage collection and encrypted staging migration rehearsal.

## Phase O parallel compatibility, receipt and restore safety batch (2026-11-25 IST)

Exact head 73eee3c56c7ecfe96ef67c24043287a6aca1bb4b: CI 45461689851 Node/Vitest and real API/MySQL succeeded; PowerShell 7 actual verifier and junction containment fixture passed, but Windows PowerShell 5.1 full agent parsing failed near certificate expiry logging (UTF-8 without BOM/non-ASCII punctuation). Unsigned MSI skipped after prerequisite failure; protected signed MSI skipped. Deployment safety 45461689850 succeeded. Do not claim full acceptance.

Parallel batch: canonical worker normalized to ASCII without changing runtime logic to address 5.1 decoding; retained actual PS 5.1 command verifier gate. Heartbeat and telemetry POSTs disable redirects, have bounded 15-second timeout and terminating errors. Durable telemetry ACK requires typed status/batch ID, integer accepted count, Boolean duplicate, parseable recorded_at; malformed receipts retain identical outbox bytes; PS 7/5.1 cadence fixtures extended. Signed recovery-evidence verifier rejects newline-tailed exact-length UUIDs and digests even with matching pinned context, negative signatures tested. Isolated MySQL backup/restore rehearsal reapplies migrations 016/017 idempotently, seeds synthetic revoked device, sealed batch receipt, usage snapshot, and review reservation, deliberately mutates/deletes them, verifies exact restored state and unique recovery challenge constraint. No production restore or encryption claim; fresh CI required. No activation, collection of private usage, or architecture approval.

Migration rehearsal uses existing disposable CI database and current schema, not an old-production-schema upgrade, encrypted off-site backup, or rollback-safe live migration. Actual usage collector remains gated by DEC-002 privacy approval; deployment implementation by DEC-001; recovery issuance by DEC-003/independent custody, local handoff and physical acceptance. No main merge, signing or production acceptance.
