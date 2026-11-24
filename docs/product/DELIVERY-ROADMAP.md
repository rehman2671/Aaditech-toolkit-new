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
