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


## Phase O quarantine reconciliation and keyed telemetry fence (2026-11-24)

Reconciled stacked #111 f3c692ce with latest #109 16c56b54, retaining master command-admission and repaired N23 fixtures rather than duplicating alternative command fence. Carried atomic never-claimed pending quarantine and audit count, merged unit coverage and two-worker quarantine fixture into master recovery/claim/result tests. Added keyed telemetry exact current credential proof and device row lock before receipt insertion/replay; isolated MySQL revoked/stale proof regressions. Master d5755e10 CI #45453396797 had three outdated N23 failures (470/473 passed), safety passed; 16c56b54 fresh CI #45454066429 in progress at observation. New reconciled source head requires fresh combined CI. Non-keyed telemetry, heartbeat, cache provenance, previously revoked reconciliation, rotation/handoff and physical acceptance remain pending. No production approval.
