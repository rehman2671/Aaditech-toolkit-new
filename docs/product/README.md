# AadiTech Enterprise — authoritative product baseline

**Baseline date:** 2026-11-23 (Asia/Kolkata)  
**Evidence baseline:** `main` at `911f509620029c513305c88b26ca0da4e1b7da37`; unmerged security PRs #75 and #76 are separately identified.  
**Scope:** requirements, architecture decisions, status evidence and implementation plan. **This documentation is not a deployment or production sign-off.**

## Original mandatory scope and architecture approval

The original `Aaditech_Endpoint_Monitoring_Management_Final_Requirements.docx` and `Aaditech_Master_Development_Directive_Go_Edition_updated.docx` remain the controlling requirements **unless the owner explicitly amends them**. The repository text mirrors `doc1_full.txt` and `doc2_full.txt` have now been **verified against the original DOCX Word-body text** by decoding the OOXML `word/document.xml` payloads and comparing whitespace/typography-normalized paragraph text. Both match exactly in normalized text. This confirms source-text fidelity but is **not** owner approval of the requirements, solution stack or PR. See [original requirements traceability and open decisions](ORIGINAL-REQUIREMENTS-TRACEABILITY.md).

**DEC-001 is unresolved:** original directive locks **Go/PostgreSQL**; actual code is **Node.js/MySQL**. This baseline reports code reality, **not owner approval of that architecture departure**. The original full feature scope (Windows/macOS/Linux, rich telemetry, in-platform signed MSI factory, health scores, reports and observability) remains mandatory unless formally amended.

## Purpose and source-of-truth rules

AadiTech is an **intranet-first, independently self-hosted enterprise IT monitoring, diagnostics and controlled remediation platform**. An office must remain operational when the internet or any optional AadiTech central service is unavailable. Hostinger and `tool.aaditechs.in` are **optional future services**, never a dependency of normal local operation.

For implementation proposals, read the original requirements and [crosswalk](ORIGINAL-REQUIREMENTS-TRACEABILITY.md) first, then:

1. [Owner decision and review handoff](REVIEW-AND-ACCEPTANCE-HANDOFF.md) and [DEC-001 stack dossier](STACK-DECISION-DOSSIER.md) — unresolved architecture and scope decisions.
2. [Original source line register](ORIGINAL-REQUIREMENTS-LINE-REGISTER.json) — traceable source lines, not completion evidence.
3. [Product requirements](PRODUCT-REQUIREMENTS.md) — what must work, scope and product acceptance.
4. [Architecture decision proposal](INTRANET-ARCHITECTURE.md) — current implemented stack versus the original stack lock and planned LAN capabilities.
5. [First-run installer and LAN acceptance](INSTALLER-AND-SETUP-ACCEPTANCE.md) — required operator journey.
6. [Feature and evidence matrix](FEATURE-ACCEPTANCE-MATRIX.md) — implementation truth, gaps and exact supporting links.
7. [Troubleshooting/auto-healing specification](TROUBLESHOOTING-AUTOHEALING.md) — 26 issue classes and safety/outcome model.
8. [Acceptance test matrix](ACCEPTANCE-TEST-MATRIX.md) — independent go/no-go gates.
9. [Acceptance evidence record](ACCEPTANCE-EVIDENCE-RECORD.md) — independently witnessed physical/E2E proof format.
10. [Delivery roadmap](DELIVERY-ROADMAP.md) and [machine-readable tracker](DELIVERY-TRACKER.json) — next actions, dependencies, priority and blockers.

**Historical conceptual and implementation documents retained (not replacements for the original DOCX):** `Documentation/PROJECT-SPEC.md` describes a previous FastAPI/PostgreSQL concept; `docs/architecture/Technical-Architecture-Spec.md` describes a Go/PostgreSQL concept. Neither reflects today's server. Real checked-in backend is **Node.js/Express + MySQL 8** (`server.js`, `db.js`, `Enterprise/docker-compose.yml`). Legacy `Enterprise/deploy/deploy.sh` and `deploy.ps1` explicitly block incompatible PostgreSQL deployments; supported `deploy-mysql.sh` currently assumes **public DNS/ACME**, **not** office-only LAN. This mismatch is a primary product gap, not an excuse to deploy via Hostinger.

Do not assume a user interface tab, API route, unit test, old checkmark, or historical `project-progress.json` 100% metric proves an end-to-end customer workflow. Generated `project-progress.json` measures *historical audit issue closure only* and is maintained by `Scripts/Index/Update-ProjectIndex.ps1`; do not manually convert it into a product-completion percentage. Product evidence and gaps live in this directory.

## Owner decisions and decision records

[Proposed owner decision review packet](OWNER-DECISION-REVIEW-PACKET.md) covers DEC-001 through DEC-005 with choices, alternatives, proof and unsigned approval fields. None is selected or accepted by this documentation.

## Implementation-ready design backlogs

- [FE-38 security status rendering contract](FE38-SECURITY-STATUS-RENDERING-CONTRACT.md) — P0 field-by-field tri-state evidence and dashboard regression cases (not fixed).
- [M1/M2 local installer implementation backlog](LAN-INSTALLATION-IMPLEMENTATION-BACKLOG.md) — design slices, trust model and real WAN-disconnected acceptance (not built).

## 2026-11-24 implementation and acceptance checkpoint — unmerged branches only

The following **exact branch heads** have completed automated PR CI and deployment-safety regression; they are **not** part of the main executable baseline, have **zero recorded independent human approvals**, and have **not** passed physical office deployment or signed-release gates.

| PR | Scope and exact head | Automated PR evidence | Current status |
| --- | --- | --- | --- |
| [#75](https://github.com/rehman2671/Aaditech-toolkit-new/pull/75) | N73 GitHub governance ruleset pagination fail-closed — `67abb1bf` | [CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45072083622), [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45072083593) | CI_VERIFIED; unreviewed/unmerged |
| [#76](https://github.com/rehman2671/Aaditech-toolkit-new/pull/76) | N74 Windows enrollment ACL **and trusted ownership before secret write** — `b56eaf9e` | [CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45279445596), [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45279445423) | CI_VERIFIED; unreviewed/unmerged |
| [#85](https://github.com/rehman2671/Aaditech-toolkit-new/pull/85) | Combined FE-38/FE-39/FE-41 truthful security/patch/MSI UI and strict Docker build; corrected audit event — `7d5c7c3b` | [CI #45282262675](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45282262675) in progress; [safety #45282262657](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45282262657) passed | CODE_COMPLETE; latest CI pending, unreviewed/unmerged |
| [#86](https://github.com/rehman2671/Aaditech-toolkit-new/pull/86) | LAN-01 read-only offline manifest and bundle hash preflight **including duplicate-key rejection** — `734f4e38` | [CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45279208002), [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45279208076) | CI_VERIFIED; unreviewed/unmerged |

| [#88](https://github.com/rehman2671/Aaditech-toolkit-new/pull/88) | Healthz false-positive MSI builder / worker status corrected — `b670040f` | [CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45281826047), [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45281826788) | CI_VERIFIED; unreviewed/unmerged |
| [#89](https://github.com/rehman2671/Aaditech-toolkit-new/pull/89) | Default-deny MSI approval digest for unset/dev/staging `NODE_ENV` — `6c974a2b` | [CI #45282162959](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45282162959) in progress; [safety #45282162892](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45282162892) passed | CODE_COMPLETE; latest CI pending, unreviewed/unmerged |

**Review and merge precedence:** choose exactly one FE-38/FE-39 source path (combined #85 *or* component #81/#84/#82), not both. Other PRs #75/#76/#88/#89/#86 are review-gated and require fresh head and post-merge tests; #88 and #85 both edit `server.js`, so rebase/conflict review is necessary after any one merge. The signed MSI workflow requires actual protected `main` and administrator-owned ruleset before it may run. Never substitute a zero-ruleset direct merge for independent source approval.

The overlapping FE-38, FE-39 and strict-build source PRs **#81/#84/#82** must not be merged again if combined PR **#85** is selected by an independent reviewer. On all PRs above, the diagnostic Windows MSI build was intentionally **skipped**, so main installer acceptance must be rerun after any authorized merges. The actual current `main` branch remains **unprotected**, with **no active rulesets** at the last connected GitHub read; governance blocker [#62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62) remains OPEN. Original stack owner decision [#79](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79) and offline one-click LAN deployment [#80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80) are unresolved. Do not confuse a standalone content-hash verifier or portal badge rendering with a production-ready office installation.

## Status vocabulary (never collapse levels)

- **NOT_STARTED**: no implementation or verified evidence.
- **IN_DEVELOPMENT**: incomplete implementation, including UI/backend mismatch.
- **CODE_COMPLETE**: functionality exists but CI or review is not sufficient.
- **CI_VERIFIED**: tests passed on a known commit, but may be synthetic/isolated.
- **E2E_VERIFIED**: supported complete workflow demonstrated on representative LAN and physical Windows clients.
- **PRODUCTION_ACCEPTED**: independently approved, secured, recoverable target environment and signed release.
- **BLOCKED**: explicit dependency prohibits advancement; preserve previous status plus blocker.

Progress must show **per acceptance dimension**, not an invented universal completion %. A green PR is not a merged code baseline. No code, infrastructure, credentials, repository rules, release or user-device state is changed by adopting this document set. See [acceptance evidence record](ACCEPTANCE-EVIDENCE-RECORD.md) for independently witnessed E2E cases.

## Change control

Every implementation PR should cite requirement IDs (`PR-`, `DEP-`, `TR-`, `AT-`) and update status/evidence **in the same PR**. Reviewers must distinguish customer evidence from isolated CI. Do not mark runtime behavior approved solely by editing a checklist. Independent human approval is required for production signing and changes to protected governance.
