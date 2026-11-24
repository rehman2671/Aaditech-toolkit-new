# Product owner / security reviewer handoff — decisions, acceptance and release boundary

**Scope:** PR #77 documentation baseline for AadiTech intranet-first enterprise platform; no software implementation, production data or customer hosting changes authorized by this handoff.

**Single proposed decision comparison:** [Owner decision review packet](OWNER-DECISION-REVIEW-PACKET.md). All five choices remain **PENDING** until explicit human approval; recommendations are not approval.

## What an owner must decide (no implicit defaults)

| ID | Required input | Reason | Decision state |
|---|---|---|---|
| DEC-001 | Keep code's Node.js/MySQL with formal amendment **or** honor directive's Go/PostgreSQL with safe migration | Material stack governance conflict; see [decision dossier](STACK-DECISION-DOSSIER.md) | **OPEN** |
| DEC-002 | Windows-first **phased launch** vs full initial Windows/macOS/Linux support | Original final requirements mandate all 3 platform agents across product scope | **OPEN** |
| DEC-003 | Original in-portal signed per-tenant MSI factory and Windows **service** requirement vs current generic signed-release framework and scheduled task; equivalence criteria or redesign | A diagnostic MSI build does not meet full original package-factory or service requirements | **OPEN** |
| DEC-004 | Prioritize full historical timeseries, process/app usage, weighted health scores, scheduled reports and platform observability; original scope must remain | MVP exit criteria and implementation sequencing | **OPEN** |
| DEC-005 | Approve proposed D0 read-only, D1 low-risk, D2 consent/IT-approval, D3 human-only repair safety tiers | Prevent unauthorized endpoint modifications and false auto-resolution counts | **OPEN** |

## Ready-to-review documents

- [Original scope crosswalk](ORIGINAL-REQUIREMENTS-TRACEABILITY.md): all 34 source sections and owner decisions.
- [Lossless source line register](ORIGINAL-REQUIREMENTS-LINE-REGISTER.json): traceable source text lines and binding directives; **NOT** line-by-line completion proof or a replacement for original DOCX.
- [Product PRD](PRODUCT-REQUIREMENTS.md), [LAN architecture](INTRANET-ARCHITECTURE.md), [installer contract](INSTALLER-AND-SETUP-ACCEPTANCE.md).
- [Feature evidence matrix](FEATURE-ACCEPTANCE-MATRIX.md), [original and LAN acceptance gates](ACCEPTANCE-TEST-MATRIX.md).
- [26-issue troubleshooting safety specification](TROUBLESHOOTING-AUTOHEALING.md).
- [Roadmap](DELIVERY-ROADMAP.md) and [tracker](DELIVERY-TRACKER.json).

## Dedicated follow-up issues

- [#79 DEC-001 — source stack lock decision](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79), owner ADR still pending.
- [#78 FE-38 — false-positive cloud/security badges](https://github.com/rehman2671/Aaditech-toolkit-new/issues/78), P0 front-end accuracy fix independent of architecture stack.
- [#62 — main protection and release gate](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62), independently approved governance changes still pending.

## Reviewer checklist

- [x] Verify both original DOCX **Word-body texts** against extracted mirrors: exact after whitespace and typography normalization (source blob SHAs recorded in line register). The DOCX binaries themselves are **not byte-identical** to text files and that is not the acceptance criterion.
- [ ] Independently review the verified source semantics, atomic acceptance cases and any later original-document revisions.
- [ ] Confirm original functional/nonfunctional scope is *not silently removed* by new Windows-first or Node/MySQL proposals.
- [ ] Resolve DEC-001 with signed ADR, anticipated data/compatibility migration and security tests.
- [ ] Confirm supported server Windows/Linux versions, LAN PKI issuance and permitted disconnected setup path.
- [ ] Resolve DEC-002/DEC-003 sequencing without implying certified production readiness.
- [ ] Confirm data residency/privacy, employee issue reporting, repair authority and incident evidence retention.
- [ ] Approve/adjust acceptance tests and accountable witness roles; no CI-only inference for office LAN.
- [ ] Check PR #75 and #76 independently; enforce main protection without reviewer bypass before production signing.
- [ ] Record explicitly which items remain BLOCKED and who can unblock them.

## CI and release snapshot

- PR #77 prior head `ff724d7e5d8bcb171bcf63dd1bc681a279ed7520`: [CI #45080562982](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45080562982) **3 jobs successful**, Windows MSI job **skipped by design on PR**; [safety #45080562980](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45080562980) **2 jobs successful**.
- Any further doc commit **requires its own exact-head CI verification**; do not cite older CI as the new commit's result.
- `main` at `911f509620029c513305c88b26ca0da4e1b7da37` was unprotected at audit. PR #77 has no independent review and stays **OPEN**. No signed production release.
- Physical office Windows/DB restoration, internal CA trust, separated installation identity and disconnected WAN are still unverified.

## Evidence submission standard

Use [the acceptance evidence record template](ACCEPTANCE-EVIDENCE-RECORD.md) for any claimed E2E or production result. CI checks are supporting evidence, not customer acceptance. Operator-private secrets, tokens, raw PII and sensitive network details must not be attached to public PRs.

## Sign-off fields (for authorized humans to fill, never simulated)

- Product owner name / date / decisions / reference:
- Architecture reviewer / date / approved ADR:
- Security reviewer / date / MSI signer boundary:
- IT/operator physical test witness / date / evidence:
- DBA backup/restore witness / date / evidence:
- Remaining blockers / accountable owner / next review:

An unanswered checkbox means **PENDING**, not approved.


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

### 2026-11-25 review addition

Independently review #113 recovery state/time bounds and intake actor/UUID/count integrity; verify connection discard on uncertain COMMIT without falsely treating rollback as proof of non-commit. Require fresh exact-head CI and reconcile with #109 before any release consideration. No approval of credential activation, diagnostic execution, architecture decisions or production.
