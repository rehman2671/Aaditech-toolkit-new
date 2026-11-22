# AadiTech Enterprise — authoritative product baseline

**Baseline date:** 2026-11-23 (Asia/Kolkata)  
**Evidence baseline:** `main` at `911f509620029c513305c88b26ca0da4e1b7da37`; unmerged security PRs #75 and #76 are separately identified.  
**Scope:** requirements, architecture decisions, status evidence and implementation plan. **This documentation is not a deployment or production sign-off.**

## Purpose and source-of-truth rules

AadiTech is an **intranet-first, independently self-hosted enterprise IT monitoring, diagnostics and controlled remediation platform**. An office must remain operational when the internet or any optional AadiTech central service is unavailable. Hostinger and `tool.aaditechs.in` are **optional future services**, never a dependency of normal local operation.

For decisions **from this baseline onward**, read in order:
1. [Product requirements](PRODUCT-REQUIREMENTS.md) — what must work, scope and product acceptance.
2. [Architecture decision](INTRANET-ARCHITECTURE.md) — approved current stack versus planned LAN capabilities.
3. [First-run installer and LAN acceptance](INSTALLER-AND-SETUP-ACCEPTANCE.md) — required operator journey.
4. [Feature and evidence matrix](FEATURE-ACCEPTANCE-MATRIX.md) — implementation truth, gaps and exact supporting links.
5. [Troubleshooting/auto-healing specification](TROUBLESHOOTING-AUTOHEALING.md) — 26 issue classes and safety/outcome model.
6. [Acceptance test matrix](ACCEPTANCE-TEST-MATRIX.md) — independent go/no-go gates.
7. [Delivery roadmap](DELIVERY-ROADMAP.md) and [machine-readable tracker](DELIVERY-TRACKER.json) — next actions, dependencies, priority and blockers.

**Historical documents retained for context, not silently rewritten:** `Documentation/PROJECT-SPEC.md` describes a previous FastAPI/PostgreSQL concept; `docs/architecture/Technical-Architecture-Spec.md` describes a Go/PostgreSQL concept. Neither reflects today's server. Real checked-in backend is **Node.js/Express + MySQL 8** (`server.js`, `db.js`, `Enterprise/docker-compose.yml`). Legacy `Enterprise/deploy/deploy.sh` and `deploy.ps1` explicitly block incompatible PostgreSQL deployments; supported `deploy-mysql.sh` currently assumes **public DNS/ACME**, **not** office-only LAN. This mismatch is a primary product gap, not an excuse to deploy via Hostinger.

Do not assume a user interface tab, API route, unit test, old checkmark, or historical `project-progress.json` 100% metric proves an end-to-end customer workflow. Generated `project-progress.json` measures *historical audit issue closure only* and is maintained by `Scripts/Index/Update-ProjectIndex.ps1`; do not manually convert it into a product-completion percentage. Product evidence and gaps live in this directory.

## Status vocabulary (never collapse levels)

- **NOT_STARTED**: no implementation or verified evidence.
- **IN_DEVELOPMENT**: incomplete implementation, including UI/backend mismatch.
- **CODE_COMPLETE**: functionality exists but CI or review is not sufficient.
- **CI_VERIFIED**: tests passed on a known commit, but may be synthetic/isolated.
- **E2E_VERIFIED**: supported complete workflow demonstrated on representative LAN and physical Windows clients.
- **PRODUCTION_ACCEPTED**: independently approved, secured, recoverable target environment and signed release.
- **BLOCKED**: explicit dependency prohibits advancement; preserve previous status plus blocker.

Progress must show **per acceptance dimension**, not an invented universal completion %. A green PR is not a merged code baseline. No code, infrastructure, credentials, repository rules, release or user-device state is changed by adopting this document set.

## Change control

Every implementation PR should cite requirement IDs (`PR-`, `DEP-`, `TR-`, `AT-`) and update status/evidence **in the same PR**. Reviewers must distinguish customer evidence from isolated CI. Do not mark runtime behavior approved solely by editing a checklist. Independent human approval is required for production signing and changes to protected governance.
