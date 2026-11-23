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
