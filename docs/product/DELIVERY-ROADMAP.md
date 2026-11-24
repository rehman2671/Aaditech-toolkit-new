# Product delivery roadmap and tracking rules (2026-11-23)

**Guiding objective:** complete a repeatable **LAN-first enterprise deployment**, then layer self-service and verifiable auto-healing. No required Hostinger/public DNS, Azure, external ITSM or central service.

## Dependencies and milestones

| Milestone | Priority | Scope and exit criteria | Status |
|---|---|---|---|
| M0 — Scope and evidence alignment | P0 | Product PRD, architecture, feature matrix, installation contract, 26 issue catalog, test matrix, tracker; independent review of docs | **DOCS PROPOSED in this PR** |
| M0A — Original source reconciliation and architecture decision | P0 | Confirm text mirrors versus DOCX, produce atomized RTM, approve Go/PostgreSQL versus Node/MySQL ADR (DEC-001), OS phasing and MSI model | **OWNER APPROVAL PENDING** |
| M1 — LAN install foundation | P0 | Choose approved stack after DEC-001; private network binding; offline runtime bundle; local PKI with operator trust; Windows + Linux supported host paths, non-destructive secrets/data handling. Existing Node/MySQL public-DNS deployment is evidence of current code, not stack approval | **NOT_STARTED / BLOCKED by architecture work** |
| M2 — One-click setup + installation ID | P0 | Single launcher + first-run web wizard, stored unique installation ID, safe reconfiguration/reinstall/clone/restore; multi-tenant bootstrap, admin | **PARTIAL existing wizard / remaining NOT_STARTED** |
| M3 — Real enterprise end-to-end acceptance | P0 | Fresh air-gapped office, 2+ Windows devices, telemetry, signed commands, ACK/retry, endpoint upgrades and backup/restore on physical endpoints | **PENDING physical evidence** |
| M4 — Troubleshooting platform | P1 | Incident catalog, D0-D3 policy, user self-service + proactive intake, versioned signed allowlisted playbooks, approval, rollback, after-check | **IN_DEVELOPMENT — advisory policy reference; integrated product pending** |
| M5 — Verified remediation analytics | P1 | Incident/attempt/outcome records, reconciliation, reopened-case guard, accurate dashboards, tenant/installation reports | **NOT_STARTED** |
| M6 — Optional central and integrations | P2 | User-approved `tool.aaditechs.in` registration/update or external services without offline dependency | **NOT_STARTED / optional** |
| M7 — Original mandatory capability parity | Mandatory phased | macOS/Linux, full signed MSI factory, rich metrics and health scores, scheduled reports and HA/observability | **OPEN, owner-approved scheduling required** |

Security reviews, signed package integrity and isolated regression tests are **cross-cutting requirements every milestone**, not deferred to the final phase. M3 E2E should happen early and repeat after any critical update.

**Tracker milestone parity:** M0A now has its own blocked machine-readable row; normalized DOCX text verification was completed, but owner approval of DEC-001/002/003 and independent source RTM review remain outstanding. M1 is intentionally stack-neutral before DEC-001 approval.

## Decision completeness

All five unresolved owner decisions (DEC-001 through DEC-005) now appear in the machine-readable tracker. See [owner review packet](OWNER-DECISION-REVIEW-PACKET.md). A phase label, recommendation or green CI must never override an explicit signed decision.

## Architecture decision gating

Before M1/M2 work, DEC-001 must be explicitly resolved by product owner, then the original source text/DOCX fidelity and independent review recorded in [decision handoff](REVIEW-AND-ACCEPTANCE-HANDOFF.md). This doc PR does **not** grant a stack change or production approval.

## Implementation design handoffs

The P0 frontend accuracy fix uses [FE-38's exact rendering contract](FE38-SECURITY-STATUS-RENDERING-CONTRACT.md), independent of the backend stack decision. The P0 LAN installer uses [the implementation backlog](LAN-INSTALLATION-IMPLEMENTATION-BACKLOG.md) and requires the approved [DEC-001 decision](STACK-DECISION-DOSSIER.md) before changing runtime architecture. Both design handoffs still require new reviewed code PRs.

## Actionable GitHub blockers

- [DEC-001 owner architecture ADR, issue #79](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79): **P0 / unresolved owner decision** before choosing backend-language/database implementation work.
- [FE-38 security dashboard misinformation, issue #78](https://github.com/rehman2671/Aaditech-toolkit-new/issues/78): **P0 / runtime bug, fix independent of DEC-001**. The existing portal must never display unknown Azure/Intune/BitLocker/Defender values as healthy green badges; tracked as `AT-SEC-05`.
- [M1/M2 intranet server installer, issue #80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80): **P0 design/deployment**. Needs architecture ADR plus independent physical office acceptance before any 'one-click LAN ready' claim.
- [Original main protection/release blocker #62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62): repo owner and independent reviewers must activate and accept safeguards before signed production release.

Tracking issues do not implement or independently accept the capability. No issue should be closed on documentation-only evidence.

## Immediate work order after docs approval

1. Obtain DEC-001 owner ADR on original locked Go/PostgreSQL vs current Node/MySQL; preserve full original requirements and estimate impact.
2. Resolve documented stack/profile split (`deploy.sh` and `deploy.ps1` intentionally fail on MySQL; `deploy-mysql.sh` public DNS only). Design P0 LAN profile without relaxing production TLS/secret admission.
3. Decide supported first server OS baseline and offline packaging; test prerequisites on fresh machines and disconnected WAN.
4. Implement persistent per-installation UUID and clone-versus-restore semantics before any optional central registration.
5. Integrate installer + first-run browser setup, per-device trust distribution and physical LAN acceptance.
6. Only then start controlled issue playbooks (read-only first), user self-service, policy and audit/verification dashboard.
7. Optional cloud/integrations come after independent local product acceptance.

## P0 dashboard security truthfulness gate

**FE-38 / AT-SEC-05:** current portal's Cloud Identity Audit renders green Azure AD, Intune, BitLocker and Defender badges even when backend states NOT_CONNECTED or unknown. Marked release blocking until a future reviewed implementation renders actual field values with neutral unknown states and tests; this documentation PR does not repair runtime UI.

## Existing review/production blocker

- [N73 PR #75](https://github.com/rehman2671/Aaditech-toolkit-new/pull/75): 3/3 CI + 2/2 safety green; not merged or independently reviewed.
- [N74 PR #76](https://github.com/rehman2671/Aaditech-toolkit-new/pull/76): 3/3 CI + 2/2 safety green including Windows PowerShell 5.1/7 setup regression; not merged or independently reviewed.
- [Issue #62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62): active main protection, independent approvals/signing, live infrastructure acceptance unresolved.
- Real enterprise server/Windows devices, signed production MSI and customer/offsite restore evidence remain absent. Do **not** self-approve or merge around owner review.

## Ownership and milestone governance

For every ticket/PR record requirement ID, owner role, dependency, target behavior, test plan, code commit, PR/review state, evidence run, site/witness (if physical), blocker, rollback and the next exact action. Status flow `NOT_STARTED -> IN_DEVELOPMENT -> CODE_COMPLETE -> CI_VERIFIED -> E2E_VERIFIED -> PRODUCTION_ACCEPTED`; `BLOCKED` is an independent blocker field, not a misleading replacement for verified work. No completion-percent calculation until requirement-level weights and sign-off criteria have been formally approved.

**Document release rule:** Never infer source code completion from an approved PRD or from historical phase numbers. Docs in this PR change no code; accept the docs first, then open implementation PRs against the accepted requirements.

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

## Phase O parallel replay compatibility, restore input integrity and review lifecycle (2026-11-25 IST)

Exact head cbc28e7aa4f24471e80f425a837d97a15fbf2885: CI 45462429321 Node/Vitest and API/MySQL passed; native Windows PowerShell 5.1 and 7 signed command verification/script containment passed; PS7 strict telemetry cadence passed, PS5.1 single-event lost-ACK retry assertion failed, unsigned MSI skipped. Safety 45462429336 both jobs passed, with actual security-state restoration and duplicate challenge refusal confirmed in job 138688350821.

Parallel batch: normalize SQLite JSON array parsing across PS5.1/7 by assigning decoded arrays before normalization; retain immutable stored batch, validate positive distinct bounded event IDs, stored body batch ID/event count and corresponding client ID suffix before sending. Multi-event/corrupt-ID regression and safe fixture logging added. Restore stages SQL and sidecar in a private temporary directory before validation; import staged bytes, not a mutable source pathname; fake Docker test replaces original after validation and verifies original staged bytes imported. Internal read-only inspectRecoveryReview validates persisted request scope, state/time, generation and current active admins under locks, returns categorical pending/reserved/expired/stale status with no proof secrets or activation, mock and real MySQL coverage. Fresh CI required; no new migration, no issuance, no HTTP endpoint. Staged restore remains plaintext, not protection against a privileged attacker or replacement of both source and checksum before validation.

Retain PS5.1 gate and exact receipt checks, do not weaken acceptance. Independent evidence custody, approved activation policy, secure Windows handoff, encrypted offsite backup and operator restore approval remain required. DEC-001/002/003 decisions not inferred; no main merge, signing or production acceptance.

## Phase O parallel encrypted rehearsal and review expiry checkpoint (2026-11-25 IST)

Exact head fc42a8c29c01343b12897c720ea4a071405422cc: CI 45463569787 Node/Vitest, PowerShell (both PS5.1/7 command and durable ACK tests), real API/MySQL passed; unsigned MSI running at observation, protected signing skipped. Safety 45463569642 actual MySQL restore passed; offline regression failed because the synthetic sidecar was copied over the candidate SQL filename instead of candidate.sql.sha256. Correct fixture without weakening validation.

Parallel backup/recovery batch: correct staged restore fixture destination; reject incomplete mysqldump even on zero exit and noncanonical/oversized retention values before Docker; add offline negatives. Existing bounded POSIX AES-256-GCM and pinned Ed25519 manifest reference now exercised on actual isolated MySQL dump via CI-only helper, ephemeral in-memory keys, wrong-key refusal, exact recovered SQL comparison and normal explicit --db-only restore with security-table preservation assertions. This is a bounded 64 MiB disposable fixture, not a live production encrypted backup executor. Review request admission now scopes open window to current credential fingerprint and effective signed reservation expiry, retaining old records/challenge/evidence uniqueness; unit SQL contract and real MySQL expired reservation regression. No HTTP route, grant, token issuance, new migration or production approval. Fresh CI required.

DEC-001/002/003 remain owner-gated. Independent signer/key custody, streaming large backups, authenticated offsite restore/old-host fencing, activation policy and physical Windows handoff not implemented. Existing plaintext backup remains; encryption exercised only in isolated CI, no production backup format or restore policy changed. No main merge or signing.

## Phase O parallel troubleshooting and setup progress foundation (2026-11-25 IST)

Exact prior head 2f01ffd8b56e087f08895d97e7ab2b8ad486a8e0: CI 45464297470 all four executable jobs passed including unsigned Windows MSI lifecycle; protected signing skipped. Deployment safety 45464297462 offline job passed, live MySQL job failed at startup socket ERROR 2002 before encrypted recovery ran. Do not claim encrypted restore acceptance.

Parallel batch: isolated MySQL rehearsal requires authenticated TCP connection to the final server (temporary initialization server uses skip-networking), bounded idempotent marker retries and final TCP probe before migration/seed; no retry of ambiguous non-idempotent writes. M4 now has executable advisory catalog TR-01..26 with conservative D3 escalation for physical hazards, malware, blue-screen, display and driver uncertainty; default-deny categorical consent/policy triage, no collector/repair authorization, outcome classifier refuses ACK-as-resolution; unit tests. M2 adds read-only redacted setup progress projection from actually verified independently pinned journal checkpoint, distinguishing RECORDED_COMPLETE, RECONCILIATION_REQUIRED and NOT_RECORDED; no paths, IDs, pins, execution or acceptance; tests including all stages recorded and stale checkpoint. Fresh combined CI and encrypted disposable recovery must pass.

M4 moves to IN_DEVELOPMENT as advisory reference only, not integrated product: persistent incident/attempt store, privacy-approved diagnostic adapters, authenticated consent and operator approval, signed playbooks, rollback, independent outcomes and field tests remain pending. DEC-005 remains blocked; conservative policy does not approve D1/D2 execution. M2 remains reference only; no browser endpoint, current anchor distribution, runtime/Windows ACL adapter or setup mutation. DEC-001/002/003/005 remain owner-gated. No protected signing, main merge or production acceptance.

## Phase O parallel incident persistence, signed setup display binding and restore continuity (2026-11-25 IST)

Exact head 8d33c0c1572e12225793614cd811388635c7523c: CI 45477940714 four executable jobs passed, including unsigned MSI lifecycle; protected signing skipped. Deployment safety 45477940884 both jobs passed; real job 138743032490 logs explicitly confirm authenticated AES-GCM disposable MySQL dump recovery and preserved credential revocation, receipt, usage snapshot and review reservation.

Parallel batch: migration 018 and baseline schema introduce internal technician categorical incident intake; authenticated caller and installation identity remain trusted-adapter prerequisites. Active current tenant SUPER_ADMIN and exact device scope locked in transaction, installation/tenant/actor/request idempotency, conflicting retries denied, one atomic audit, redacted own-record inspection, no free text, no employee endpoint, no consent/diagnosis/repair/verified resolution. Mock and actual concurrent MySQL regression included. Expanded encrypted isolated restore rehearsal preserves incident and intake uniqueness. Setup reference verifies short-lived (max 120s) Ed25519 display handoff evidence, independently pinned digest/key, installation/release/current checkpoint/challenge/session binding, canonical bytes and trusted clock; rechecks anchored journal before redacted display projection. No browser login, session authentication, challenge consumption, execution or setup mutation. Fresh combined CI required.

Conservative scope: M4 persists only minimal categorical internal technician intake and escalation, not employee/proactive workflows or attempt records. DEC-005 owner approval, retention/privacy and authenticated adapter remain required before exposure. Installation ID is supplied by trusted internal adapter, not proven by store. M2 remains a reference; independent signer/clock/challenge custody, one-use session handoff and runtime/Windows ACL adapter are pending. No live credential activation, main merge, production signing or acceptance.
