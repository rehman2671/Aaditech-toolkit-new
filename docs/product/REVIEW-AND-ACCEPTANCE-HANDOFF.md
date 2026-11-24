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
