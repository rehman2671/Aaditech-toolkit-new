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
| M4 — Troubleshooting platform | P1 | Incident catalog, D0-D3 policy, user self-service + proactive intake, versioned signed allowlisted playbooks, approval, rollback, after-check | **NOT_STARTED as integrated product** |
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


## Phase O legacy telemetry transactional admission (2026-11-24)

Reconciled #111 6e82e7e3 with #109 dc746c31; retain master keyed telemetry/heartbeat locks and tests, preserve unique first-revocation pending-command quarantine and receipt-count tests. Deployed unkeyed telemetry now shares the same credential-checked SQL transaction for device status, measurements, processes, events, alerts/outbox, with no synthetic batch receipt or false replay guarantee; demo-only prior compatibility path isolated to NODE_ENV=test. Added real MySQL positive/stale/revoked/rollback/no-receipt cases and two-worker legacy HTTP coverage. Master safety #45454627043 passed; CI #45454627250 running at observation. New exact-head CI required. Redis post-commit app-usage provenance, prior revoked device reconciliation, authorized rotation/handoff and physical acceptance remain open. No production approval.


## Phase O app-usage provenance (2026-11-24)

Master #109 dc746c31 CI #45454627250 Node/PowerShell/API passed, MSI running at observation; safety #45454627043 passed. Prior #111 52b0a9ae Node CI #45455142038 passed, API/PowerShell running at observation. Proposed migration 016 moves deployed app-usage evidence into one bounded per-device MySQL snapshot within the credential-locked telemetry transaction, no Redis import/fallback; tenant/current-active credential fingerprint and 15-minute server freshness checked on read. Explicit empty observation and 100-row/64 KiB bound; real MySQL negative tests added. Migration staging/backup, fresh CI and production acceptance pending; no collector acquisition claim, previously revoked command reconciliation or credential rotation/handoff yet.


## Phase O previously revoked device reconciliation (2026-11-24)

Proposed #111 explicit tenant SUPER_ADMIN bearer-only previously revoked device reconciliation endpoint. Under same device-row lock, only never-claimed PENDING rows with null execution timestamps are cancelled; one atomic audit for actual changes, zero-change retry, outstanding count and replacement_allowed=false. Added mocked and real two-worker HTTP/SQL regressions. No uncertain/in-progress command resolution or replacement issuance. #109 116413a9 API failed due obsolete unkeyed tenant fixture; corrected on master a0848795, mandatory keyed policy preserved there. #111 alternative unkeyed compatibility and app-usage migration 016 need conflict-aware review against newer master. No exact-head migration CI observed; fresh CI and staging migration required; production not accepted.
