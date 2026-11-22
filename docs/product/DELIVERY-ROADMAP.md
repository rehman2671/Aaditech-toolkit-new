# Product delivery roadmap and tracking rules (2026-11-23)

**Guiding objective:** complete a repeatable **LAN-first enterprise deployment**, then layer self-service and verifiable auto-healing. No required Hostinger/public DNS, Azure, external ITSM or central service.

## Dependencies and milestones

| Milestone | Priority | Scope and exit criteria | Status |
|---|---|---|---|
| M0 — Scope and evidence alignment | P0 | Product PRD, architecture, feature matrix, installation contract, 26 issue catalog, test matrix, tracker; independent review of docs | **DOCS PROPOSED in this PR** |
| M0A — Original source reconciliation and architecture decision | P0 | Confirm text mirrors versus DOCX, produce atomized RTM, approve Go/PostgreSQL versus Node/MySQL ADR (DEC-001), OS phasing and MSI model | **OWNER APPROVAL PENDING** |
| M1 — LAN install foundation | P0 | Reconcile Node/MySQL deployment; private network binding; offline runtime bundle; local PKI with operator trust; Windows + Linux supported host paths, non-destructive secrets/data handling | **NOT_STARTED / BLOCKED by architecture work** |
| M2 — One-click setup + installation ID | P0 | Single launcher + first-run web wizard, stored unique installation ID, safe reconfiguration/reinstall/clone/restore; multi-tenant bootstrap, admin | **PARTIAL existing wizard / remaining NOT_STARTED** |
| M3 — Real enterprise end-to-end acceptance | P0 | Fresh air-gapped office, 2+ Windows devices, telemetry, signed commands, ACK/retry, endpoint upgrades and backup/restore on physical endpoints | **PENDING physical evidence** |
| M4 — Troubleshooting platform | P1 | Incident catalog, D0-D3 policy, user self-service + proactive intake, versioned signed allowlisted playbooks, approval, rollback, after-check | **NOT_STARTED as integrated product** |
| M5 — Verified remediation analytics | P1 | Incident/attempt/outcome records, reconciliation, reopened-case guard, accurate dashboards, tenant/installation reports | **NOT_STARTED** |
| M6 — Optional central and integrations | P2 | User-approved `tool.aaditechs.in` registration/update or external services without offline dependency | **NOT_STARTED / optional** |
| M7 — Original mandatory capability parity | Mandatory phased | macOS/Linux, full signed MSI factory, rich metrics and health scores, scheduled reports and HA/observability | **OPEN, owner-approved scheduling required** |

Security reviews, signed package integrity and isolated regression tests are **cross-cutting requirements every milestone**, not deferred to the final phase. M3 E2E should happen early and repeat after any critical update.

## Immediate work order after docs approval

1. Obtain DEC-001 owner ADR on original locked Go/PostgreSQL vs current Node/MySQL; preserve full original requirements and estimate impact.
2. Resolve documented stack/profile split (`deploy.sh` and `deploy.ps1` intentionally fail on MySQL; `deploy-mysql.sh` public DNS only). Design P0 LAN profile without relaxing production TLS/secret admission.
3. Decide supported first server OS baseline and offline packaging; test prerequisites on fresh machines and disconnected WAN.
4. Implement persistent per-installation UUID and clone-versus-restore semantics before any optional central registration.
5. Integrate installer + first-run browser setup, per-device trust distribution and physical LAN acceptance.
6. Only then start controlled issue playbooks (read-only first), user self-service, policy and audit/verification dashboard.
7. Optional cloud/integrations come after independent local product acceptance.

## Existing review/production blocker

- [N73 PR #75](https://github.com/rehman2671/Aaditech-toolkit-new/pull/75): 3/3 CI + 2/2 safety green; not merged or independently reviewed.
- [N74 PR #76](https://github.com/rehman2671/Aaditech-toolkit-new/pull/76): 3/3 CI + 2/2 safety green including Windows PowerShell 5.1/7 setup regression; not merged or independently reviewed.
- [Issue #62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62): active main protection, independent approvals/signing, live infrastructure acceptance unresolved.
- Real enterprise server/Windows devices, signed production MSI and customer/offsite restore evidence remain absent. Do **not** self-approve or merge around owner review.

## Ownership and milestone governance

For every ticket/PR record requirement ID, owner role, dependency, target behavior, test plan, code commit, PR/review state, evidence run, site/witness (if physical), blocker, rollback and the next exact action. Status flow `NOT_STARTED -> IN_DEVELOPMENT -> CODE_COMPLETE -> CI_VERIFIED -> E2E_VERIFIED -> PRODUCTION_ACCEPTED`; `BLOCKED` is an independent blocker field, not a misleading replacement for verified work. No completion-percent calculation until requirement-level weights and sign-off criteria have been formally approved.

**Document release rule:** Never infer source code completion from an approved PRD or from historical phase numbers. Docs in this PR change no code; accept the docs first, then open implementation PRs against the accepted requirements.
