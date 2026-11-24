# Phase O — Master integration reconciliation

Observation: 2026-11-24. Main 911f509620029c513305c88b26ca0da4e1b7da37 is unprotected and rulesets empty. #108 latest exact head f88143083f4d9de8d980aaf215990e281d1218cd (CI 45390061413 and deployment safety 45390061331 SUCCESS) is the selected code base; #77 c6eafa1f13ad0998fc0572cf6c0daa26e59f1462 supplies current product baseline; #75 67abb1bff711a400b55b3f695311917a7d3069c9 supplies governance pagination hardening. Checked 33 open PRs. Compare each PR changed-file blob against #108; exact matches are evidence of identical bytes, changed paths are not proof of equivalent behavior. #77 (26 paths) and #75 (6 paths) are non-overlapping with #108 changes relative to main and each other; imported as exact blobs except deliberate documentation reconciliation below. The source #108 includes the independently pinned checkpoint verifier. Fresh combined CI and independent review required. This is a review candidate, not a release.

| PR | Changed paths | Exact in #108 | Proposed disposition |
|---:|---:|---:|---|
| [#108](https://github.com/rehman2671/Aaditech-toolkit-new/pull/108) | 95 | 95 | BASE |
| [#107](https://github.com/rehman2671/Aaditech-toolkit-new/pull/107) | 89 | 88 | SUCCESSOR |
| [#106](https://github.com/rehman2671/Aaditech-toolkit-new/pull/106) | 83 | 81 | SUCCESSOR |
| [#105](https://github.com/rehman2671/Aaditech-toolkit-new/pull/105) | 70 | 69 | SUCCESSOR |
| [#104](https://github.com/rehman2671/Aaditech-toolkit-new/pull/104) | 7 | 6 | SUCCESSOR |
| [#103](https://github.com/rehman2671/Aaditech-toolkit-new/pull/103) | 4 | 4 | EXACT |
| [#102](https://github.com/rehman2671/Aaditech-toolkit-new/pull/102) | 68 | 66 | SUCCESSOR |
| [#101](https://github.com/rehman2671/Aaditech-toolkit-new/pull/101) | 30 | 25 | SUCCESSOR |
| [#100](https://github.com/rehman2671/Aaditech-toolkit-new/pull/100) | 5 | 2 | SUCCESSOR |
| [#99](https://github.com/rehman2671/Aaditech-toolkit-new/pull/99) | 25 | 18 | SUCCESSOR |
| [#98](https://github.com/rehman2671/Aaditech-toolkit-new/pull/98) | 5 | 1 | SUCCESSOR |
| [#97](https://github.com/rehman2671/Aaditech-toolkit-new/pull/97) | 11 | 8 | SUCCESSOR |
| [#96](https://github.com/rehman2671/Aaditech-toolkit-new/pull/96) | 5 | 4 | SUCCESSOR |
| [#95](https://github.com/rehman2671/Aaditech-toolkit-new/pull/95) | 6 | 4 | SUCCESSOR |
| [#94](https://github.com/rehman2671/Aaditech-toolkit-new/pull/94) | 5 | 4 | SUCCESSOR |
| [#93](https://github.com/rehman2671/Aaditech-toolkit-new/pull/93) | 20 | 17 | SUCCESSOR |
| [#92](https://github.com/rehman2671/Aaditech-toolkit-new/pull/92) | 7 | 5 | SUCCESSOR |
| [#91](https://github.com/rehman2671/Aaditech-toolkit-new/pull/91) | 5 | 2 | SUCCESSOR |
| [#90](https://github.com/rehman2671/Aaditech-toolkit-new/pull/90) | 4 | 3 | SUCCESSOR |
| [#89](https://github.com/rehman2671/Aaditech-toolkit-new/pull/89) | 3 | 2 | SUCCESSOR |
| [#88](https://github.com/rehman2671/Aaditech-toolkit-new/pull/88) | 3 | 2 | SUCCESSOR |
| [#86](https://github.com/rehman2671/Aaditech-toolkit-new/pull/86) | 3 | 2 | SUCCESSOR |
| [#85](https://github.com/rehman2671/Aaditech-toolkit-new/pull/85) | 11 | 9 | SUCCESSOR |
| [#84](https://github.com/rehman2671/Aaditech-toolkit-new/pull/84) | 2 | 1 | SUCCESSOR |
| [#82](https://github.com/rehman2671/Aaditech-toolkit-new/pull/82) | 2 | 2 | EXACT |
| [#81](https://github.com/rehman2671/Aaditech-toolkit-new/pull/81) | 5 | 3 | SUCCESSOR |
| [#77](https://github.com/rehman2671/Aaditech-toolkit-new/pull/77) | 26 | 0 | IMPORT |
| [#76](https://github.com/rehman2671/Aaditech-toolkit-new/pull/76) | 5 | 4 | SUCCESSOR |
| [#75](https://github.com/rehman2671/Aaditech-toolkit-new/pull/75) | 6 | 0 | IMPORT |
| [#61](https://github.com/rehman2671/Aaditech-toolkit-new/pull/61) | 46 | 1 | HISTORICAL_REVIEW |
| [#4](https://github.com/rehman2671/Aaditech-toolkit-new/pull/4) | 13 | 0 | HISTORICAL_REVIEW |
| [#3](https://github.com/rehman2671/Aaditech-toolkit-new/pull/3) | 15 | 0 | HISTORICAL_REVIEW |
| [#2](https://github.com/rehman2671/Aaditech-toolkit-new/pull/2) | 24 | 0 | HISTORICAL_REVIEW |

BASE: selected code tree. EXACT: all PR changed blobs match. SUCCESSOR: all differing paths have changes in the candidate, often later combined changes; verify semantic retention and selected alternative before closing. IMPORT: non-overlapping source files added to candidate. HISTORICAL_REVIEW: deliberately not merged; inspect original-base patch and compare against current runtime. No source PR closed or merged. No implied independent approval.

## Historical residual review

- #61 N64–N74 draft is based on older implementation. Its complete tree differs from current main on 74 paths including removal of newer compiler-continuity, archive safety, WiX continuity, release configuration, live-main governance and strict VPS gates. Do not copy its full tree or publish workflow. Review its 46 PR patch paths for still-needed immutable action pins, diagnostics and signer admission. #75 and #76 are the current narrow changes; do not claim #61 fully covered.
- #2/#3/#4 are old stacked drafts against different bases; their actual PR patch sizes are 24/15/13 files. Whole historical trees differ from current main on 337/341/345 paths respectively. Do not restore older server.js, db.js, Agent-Collect.ps1, WiX, workflows or migrations. Audit original tenant isolation, per-device trust, unsafe elevation retirement and MSI lifecycle requirements against current code and tests; transplant only verified missing controls with fresh regression evidence.
- #81/#84/#82 alternative UI/build changes selected via #85, then #102. #95–#100 via #101/#102. #88–#94 via #93/#102. #103–#108 layered LAN/identity/reference preflights. Exact blob counts and candidate modifications do not prove all semantic equivalence.

## Architecture freeze proposal (not owner ADR)

Recommend DEC-001A: formally retain existing Node.js/Express + MySQL 8 for first supported LAN release, conditional on explicit owner approval amending original Go/PostgreSQL stack lock. Modular API/worker deployment, approved Linux runtime (Windows Server host via reviewed VM model or later native adapter, not assumed supported), local private HTTPS, persistent identity, signed offline package, browser bootstrap and reconfiguration. Preserve APIs, data ownership and full original scope; no migration merely to satisfy an unapproved architecture choice. If DEC-001B selected, develop a separate Go/PostgreSQL migration and parity/rollback plan first. See STACK-DECISION-DOSSIER.md and owner decision packet. No final stack freeze asserted.

## Execution gates

O1: independent review of selected source and residual semantic gaps, fresh combined CI, protected main configuration and real non-bypass rule verification (#62). O2: owner DEC-001A/B and OS/runtime scope approval, no silent stack change. O3: integrate reference preflights into actual locked, persistent installer/runtime and authenticated browser bootstrap. O4: build complete pinned signed offline payload and pilot in isolated WAN-disconnected environment, two physical Windows clients, telemetry/commands/reconnect/tenant boundaries. O5: encrypted DB-consistent backup/restore, certificate rotation, interruption/reconfigure/upgrade and rollback with independent evidence. O6: implement phased troubleshooting and controlled remediation against real telemetry; signed release and acceptance remain separate. No production deployment, signing or merge without authorized evidence.

Review focus: `server.js`, `db.js`, `Enterprise/agent/Agent-Collect.ps1`, `Enterprise/portal/index.html`, `.github/workflows/ci.yml`, agent packaging, publisher workflow and selected historical residuals. Use machine-readable PHASE-O-PR-RECONCILIATION.json for the observation snapshot; re-run on source changes.


## O1 historical review — #3 residual found and patched

Current WiX still registered the legacy SYSTEM helper and installed worker still accepted -ElevatedOnce, ran elevated collectors and used lower-privilege writable configuration. Retire that path before any module/config/network access; remove automatic elevated collectors and deny all Request-ElevatedJob requests. Preserve MSI component/file continuity while replacing helper with exact root task retirement only, fail checked installation if absence cannot be verified. Add AST/entrypoint and mock task retirement regressions. This is a targeted current-tree change, not an import of #3; real MSI install/repair/upgrade and prior task lifecycle still require isolated Windows acceptance. #2 and #4 residuals remain open; #4 short-host aliases and current token/cache boundaries merit targeted review. #61 current pinned workflow and strict npm already present, but complete release controls need independent review.

### O1 combined CI regression reconciliation

Exact head `c9111ec4` CI [45391546013](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45391546013) failed: 456/457 tests passed; the UUID lifecycle source contract still required two call sites after the privileged cycle was removed. PowerShell passed, API and MSI jobs skipped; [safety 45391546036](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45391546036) passed. Corrected the contract to require exactly one execution and outbox delivery call site, the early elevated-entry refusal, no legacy delegation in main, and execution-before-delivery. Existing signature/claim/record ordering and strict receipt tests preserved. Fresh combined CI required; no worker runtime change, no merge approval.

### O1 historical #4 residual — first-use enrollment and exact identity

Previous integrated head `83888536` CI #45439614555 and safety #45439614452 passed. Current patch removes explicit bootstrap re-enrollment credential replacement, denies existing identity before consuming bootstrap under the existing identity lock, limits deployed device target matching to stored full hostname/UID/ID (legacy aliases only explicit test fixtures), and redacts legacy auth hashes/prefixes plus registration response stored secrets. Pure helper regressions added. Existing endpoints may require exact enrolled hostname or UID; recovery/rotation needs a separately approved flow, not a bootstrap overwrite. Fresh combined CI and real multi-replica device authentication/rotation tests required. No full #4 acceptance or #2 closure.

### Phase O Windows MSI retirement rehearsal

Exact prior head `937a3a97`: CI [45443140077](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45443140077) and deployment safety [45443140053](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45443140053) completed successfully; not evidence of the new MSI changes. `e46b7cd3` extends actual major upgrade rehearsal with a disabled, triggerless, inert root legacy-task fixture; confirms absence after fresh install, upgrade and uninstall, NETWORK SERVICE routine principal, owned-fixture cleanup and existing tenant/SQLite preservation. Hosted-runner only. A separate read-only same-repository integration PR diagnostic job runs real unsigned builds and lifecycle tests without protected environment, signing credentials, publication or artifact upload; N70 action-pin and isolation regressions updated. Fresh CI and actual job success required, not yet accepted. No independent review, merge or production authorization.

### O1 diagnostic CI guard reconciliation

At `36e8f200`, CI #45444870106 failed N62 because the same exact approved compiler install pins now occur once in each of two build jobs, and N70 because its raw secret-context regex matched ordinary prose `environment secrets.`. Deployment safety #45444870101 passed. N62 now requires both named jobs to contain each exact pin once and checks global count two; N70 refuses all GitHub expression interpolation within the isolated diagnostic job, requires exact executable build/lifecycle command lines and their order, and retains permissions/environment/action/no-publication checks. Added negative fixtures for compiler drift, secret interpolation, write permissions and commented-out execution. This is guard reconciliation, not a bypass or MSI lifecycle acceptance. Fresh CI required.

### O1 N62 source reconstruction

At `9fbf9032`, Node/Vitest and N70 lint passed, safety #45446897874 passed; CI #45446897752 PowerShell parser rejected N62 due to a malformed text substitution which duplicated the tail of the test. Reconstructed from the previous clean source with literal replacement, retaining per-job and global exact pin assertions. Verified both named job boundaries and all four expected pin occurrences structurally; native PowerShell parser and full combined CI must run again. No policy or production workflow relaxation.

## Phase O — integration evidence checkpoint (2026-11-24 IST)

[PR #109](https://github.com/rehman2671/Aaditech-toolkit-new/pull/109) exact tested head `7b4a0ebf2b65eb638d0e2da7a0b1aa6bbb72601a`: [CI](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45447219419) **4/4 executed jobs PASS** (PowerShell, Node/Vitest, real MySQL API, unsigned Windows MSI integration) and [deployment safety](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45447219513) **2/2 PASS**. Actual EXE/MSI build, extraction, install/uninstall and major upgrade with a disabled legacy task fixture and tenant/device/SQLite preservation. Protected signing skipped. No independent review, main merge, physical LAN acceptance or signed publication.

Historical #2 agent-trust review: the JS verifier accepted coercible fields and could throw for MAC-valid JSON null. Follow-up patch adds typed signature/device-key/clock and envelope checks and MAC-valid malformed-input regressions. Helper boundary only, not proof of Windows runtime or full historical #2/#4/#61 reconciliation. Fresh exact-head CI required. DEC-001 through DEC-005 remain owner decisions; no stack change or production approval inferred.

### O1 credential-authority follow-up (stacked review; not included in the currently running MSI rehearsal)

Deployed getDeviceByTokenHash accepts only the current exact lowercase SHA-256 in device_token_hash, refuses ambiguous matches, and never reads legacy auth_token_hash as a credential. Test-only historical compatibility remains. Regression fixtures cover legacy-only, duplicate cross-tenant records, collation mismatch, rotation and deletion. Existing legacy-only installations need explicit reviewed credential migration/re-enrollment; no automatic credential overwrite. This does not implement authorized rotation or certify multi-replica concurrency; fresh CI and independent review required before integration.

### O1 verified diagnostic milestone and credential transport follow-up

#109 7b4a0ebf2b65eb638d0e2da7a0b1aa6bbb72601a: CI #45447219419 SUCCESS 4/4 executed (protected build skipped), safety #45447219513 SUCCESS; unsigned Windows runner MSI install/upgrade/uninstall and legacy task retirement, SQLite/tenant configuration preserved; no physical signed acceptance.

#110 e5804047673b05915023b27accdb21f6a6aba008: CI #45447614754 SUCCESS 3/3 executed, both MSI jobs skipped, no separate deployment safety run; current unique device hash authority, not actual rotation workflow. New follow-up admits only canonical X-Device-Token or identical valid Bearer credentials in deployed agent authentication; body and bootstrap tokens are not accepted there (explicit enrollment unchanged), legacy compatibility only in test mode. New regression tests and fresh CI required. Existing installed agents using older header formats require reviewed migration. No authorization to rotate/revoke credentials, no main merge or production acceptance.

### O1 credential lifecycle — revocation implementation

Added explicit tenant SUPER_ADMIN bearer-only JSON POST `/api/v1/devices/:id/credentials/revoke`, exact immutable ID confirmation and fixed reason codes. Persistent MySQL row lock and tenant-scoped update plus audit insert in a single transaction, fail closed on unavailable DB or audit failure, read-only idempotent retry, no credential issuance or last-seen update. Mocked SQL-path regression cases added. Prior f0f18bb3 header-admission CI has not yet been observed. New head needs fresh combined CI and real HTTP/MySQL multi-replica revocation tests. Revocation applies to subsequent authentication; does not cancel already-running endpoint work or prove transactional fencing of in-flight requests. Recovery/rotation, legacy migration, admin consent UI and physical Windows acceptance remain open.

## Phase O combined credential-authority checkpoint — 2026-11-24

PR #109 exact head 41942da70c5c11baf618ad441add9d7c1573b5b7: CI 45449608007 4/4 executable jobs and deployment safety 45449608037 2/2 SUCCESS; typed JS signed-envelope verifier and unsigned Windows lifecycle verified; production signing skipped.

PR #110 c9128da7a5fbe5c04d60d1663712364735f950ec credential source blobs integrated into #109 review candidate; two-process HTTP/MySQL concurrent revocation rehearsal added; fresh combined CI pending; no independent approval, rotation, in-flight cancellation or production acceptance.

Original-base comparison showed eight non-overlapping #110 paths plus two overlapping tracking files. Exact source blobs retained; merged evidence and next actions without removing existing requirements (50 unique tracker IDs and all dependencies validated). Existing isolated two-production-worker MySQL fault rehearsal now also exercises explicit bearer confirmation, cookie denial, concurrent idempotent revocation, one durable audit row, unchanged last-seen and subsequent token refusal on both workers. Fresh CI required. Does not prove cross-tenant HTTP denial, rotation, cancellation, physical office or production acceptance. Historical source PR remains review history; no main merge or owner ADR.


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


## Phase O mandatory batch fixture correction (2026-11-24)

Exact #109 116413a9 CI #45455711973: Node passed; API failed in test-http-tenant-concurrency.js because fixture omitted newly mandatory stable batch ID (both workers returned 400). Added unique batch ID per synthetic sample, preserving all original credential acceptance/revocation/rotation assertions. Safety #45455711945 passed; fresh CI required. Mandatory batch admission preserved on master; alternative legacy compatibility and persistent usage snapshot in #111 need explicit conflict resolution before merge.

## Phase O command quarantine / recovery prerequisite reconciliation (2026-11-24 IST)

Exact master a0848795fdff741c05c44d9542385b8959f3e801: CI 45456389754 Node/Vitest succeeded; PowerShell and API/MySQL running at observation. Safety 45456389385 both jobs passed. Previous 116413a9 API regression from unkeyed synthetic tenant fixture was corrected in a0848795; fresh full API acceptance remains required.

Selectively reconciled #111 source 5ecd18c1939db92cb187e7721e6d95bb898c6eca command quarantine and previously revoked device reconciliation into master without importing conflicting unkeyed ingestion or migration 016. First revocation atomically cancels only PENDING rows with all pickup/execution/completion timestamps null, audits exact count, retains read-only idempotent retry. Explicit tenant SUPER_ADMIN bearer-only POST /api/v1/devices/:id/credentials/reconcile-pending requires immutable ID confirmation and fixed action CANCEL_NEVER_CLAIMED_PENDING; revoked devices only, remaining outstanding count, audit only on change, replacement_allowed=false. Source unit coverage and two-worker regression integrated; additional active-device 409 and suspicious pending-with-pickup-evidence preservation tests. No in-flight cancellation or credential issuance. Fresh CI required.

Decision for integration: retain master mandatory batch ID and current credential-generation Redis isolation. #111's persistent usage snapshot migration 016 and its alternative deployed unkeyed ingestion remain unintegrated and require separate conflict-aware review; source PR is retained, not merged wholesale. Already claimed or uncertain work remains a recovery blocker. Durable single-use recovery authorization requires independently verified endpoint ownership and owner DEC-003 policy before live issuance; no automatic migration or replacement, main merge, signing or production acceptance.


## Phase O telemetry policy reconciliation (2026-11-24)

Selective reconciliation of #111 5ecd18c1 against #109 1c90d449: master mandatory stable batch-ID admission and already-integrated command quarantine/reconciliation retained; only persistent app-usage snapshot migration 016 and relevant tests imported, no competing unkeyed production path. Snapshot commits inside keyed telemetry transaction; exact replay cannot overwrite newer data; read checks unique current active credential, tenant and freshness. Real MySQL regressions added for replay, foreign/rotated/revoked/expired, empty and oversized evidence. Prior Redis key helper retained for existing regression coverage but deployed portal no longer consumes it. Fresh combined CI and staging migration/backup required; no credential replacement or production acceptance.


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

## Phase O parallel diagnostic planning and single-use display challenge (2026-11-25 IST)

Exact prior 62c60f600fdf39212621b42e47c6eb64eeb5f478 CI 45479717135 observed: Node.js Unit & Integration Tests (Vitest + MySQL 8): success; PowerShell validation: in_progress; API test suite (Node.js vs MySQL 8): success. Safety 45479717346 both jobs passed; live job 138749275887 logs confirm AES-GCM disposable MySQL dump recovery, preserved incident intake and uniqueness along with revocation, receipt, usage snapshot and recovery reservation.

Parallel batch: migration 019 and schema baseline introduce persistent PLANNED_ONLY diagnostic plan records; exact scoped active admin/device/incident locks, catalog-derived identifier, unknown-hazard and escalated incidents blocked, no command text, consent or execution; per-incident request idempotency and atomic audit, mock and concurrent MySQL regressions. Encrypted disposable restore rehearsal now preserves both open/escalated incidents and diagnostic plan/idempotency keys. POSIX reference consumeSetupDisplayChallenge independently verifies signed display handoff/current anchored journal with copied mutable buffers, checks trusted clock again before exclusive owner-only challenge receipt, fsyncs file/directory, rejects concurrent/replayed challenges; crash-incomplete receipt fails closed, no session authentication or execution. Unit coverage for concurrent consumption and expiry. Fresh combined CI required.

Scope: a diagnostic plan is not an executed attempt; actual diagnostic evidence ingestion, attempt lifecycle, consent/approval, privacy/retention and signed playbooks remain pending DEC-005 and trusted adapters. POSIX receipt requires trusted separate persistent private directory, current independent anchor custody and caller serialization; deletion/whole-ledger rollback, cross-host coordination, clock custody, browser session authentication and Windows ACL adapter are not solved. No actual session grant, recovery activation, main merge, production signing or production acceptance.

## Phase O parallel migration lock, diagnostic evidence and reporting foundation (2026-11-25 IST)

Exact prior 0c67a3caa3235f1ca3f4e56b1adf0d64040d2894 CI 45480282830 observed: Node.js Unit & Integration Tests (Vitest + MySQL 8): success; PowerShell validation: success; API test suite (Node.js vs MySQL 8): success; Phase O unsigned Windows MSI integration rehearsal: in_progress; Build agent exe + MSI: skipped. Safety 45480282914 both jobs passed; live job 138751242518 confirmed AES-GCM disposable MySQL dump recovery preserving diagnostic plans and security records. API job 138751820134 confirmed concurrent intake/diagnostic plan idempotency without action authorization.

Parallel batch: schema migration advisory lock now held on one dedicated MySQL session for lock acquisition, all schema SQL, partition maintenance and confirmed release; acquisition errors/timeouts fail closed and uncertain sessions destroyed. Missing migration directory fails instead of success. Unit tests and real three-connection lock serialization fixture. Signed diagnostic artifact review-only verifier uses bounded canonical JSON, independent payload and Ed25519 key pins, installation/tenant/device/incident/plan/catalog diagnostic/current credential fingerprint/challenge/artifact digest and five-minute clock binding; explicitly not artifact content proof, execution or approval. Scope-limited internal intake aggregate counts reported/open/escalated/distinct planned incidents, leaves unavailable diagnostic, attempt, resolution and rate metrics null; mocked and real MySQL coverage. POSIX setup display ledger rejects nested journal/ledger paths and rechecks time after fsync, burns expired receipt without returning success. Fresh CI required.

No new SQL migration; existing 019 remains latest. Diagnostic evidence verifier is offline only; actual trusted pins, current credential resolution, independently reviewed artifact content, durable attempt records, privacy/retention and DEC-005 remain required. Aggregate is own technician/device scope only, not a tenant dashboard or measured outcomes. Setup ledger still requires external trusted custody, clock, serialization and rollback resistance; no browser auth or Windows ACL adapter. Migration DDL is not transactional rollback; historical checksum drift and production upgrade rehearsal remain separate. No credential activation, automatic repair, main merge, signed release or production acceptance.

## Phase O parallel migration history, credential boundary and diagnostic content checkpoint (2026-11-25 IST)

Exact prior head 840cc9cddef9092bc44f5aab289e723fff180f7b: CI 45481323903 all four executable jobs passed (Node/Vitest, PowerShell, API/MySQL and unsigned Windows MSI lifecycle); protected signed installer skipped. Deployment safety 45481324009 both jobs passed.

Parallel batch: validate all ordered migration source names/versions/checksums and complete recorded prefix before executing pending DDL, fail on missing/unknown/drifted records, never rewrite old checksums automatically; maintain same session lock, defer startup ready until schema validation and migration completes. Unit history tests plus disposable MySQL intentional checksum corruption/refusal/restoration. Windows worker validates canonical per-device token and typed identity/response, refuses bootstrap fallback on malformed existing token or missing paired token, blocks redirects and bounds timeout for enrollment, poll and update check; native cleanup/credential tests run in PS5.1 and 7. Bounded RESOURCE_PRESSURE signed artifact format admits only canonical JSON CPU/RAM/disk percentages or explicit null; rejects extra/private fields and mismatched digest; verifies format/bytes but not measurement truth or execution. Fresh CI required; no new SQL migration.

Strict history verification may intentionally block a historical installation whose applied migration files changed or whose checksum is missing; do not auto-rebaseline. Reconcile against original approved release, independently verify schema/data and rehearse upgrade/restore before operator-authorized repair. Checksums are not publisher signatures or live schema proof; MySQL DDL is not transactionally rollbackable. Windows changes do not supply atomic credential-pair handoff, ACL/DPAPI storage or new trust bootstrap policy; legacy certificate paths require separate review. Diagnostic artifact content is format/digest only, no privacy-sensitive collector, attempt execution, authorization or repair. DEC-001/002/003/005, independent custody, production signing and protected main remain pending. No production acceptance.
