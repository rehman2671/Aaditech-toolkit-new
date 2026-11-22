# Phase N Stage 70 — Universal required safety checks and immutable GitHub Actions

**Status: CODE/NEGATIVE TESTS PROPOSED; CI AND INDEPENDENT ACTION-PROVENANCE REVIEW PENDING; PRODUCTION RELEASE BLOCKED (2026-11-22).**

## Required-check deadlock addressed

Previously `.github/workflows/deployment-safety.yml` was filtered by changed file paths on both main push and pull requests. GitHub cannot safely require its two safety status checks for **every** security PR if an unrelated PR doesn't trigger that workflow. `main` remains **unprotected**, with no branch ruleset configured by the authorized repository administrator (tracked in issue #62).

N70 now runs the same two safety jobs on **every main-targeted PR** and **every main push**, keeping the real isolated MySQL backup/restore and Bash regression coverage. Manual workflow dispatch remains available. This is a prerequisite for requiring their exact check contexts; it does **not** itself enable any live branch protection or create independent reviewer approvals.

## Supply-chain immutability

All **13** GitHub-hosted action references in the four tracked workflows (`ci.yml`, `deployment-safety.yml`, `project-index-maintenance.yml`, `publish-signed-installer.yml`) have been replaced with exact 40-digit commit hashes from the official actions owner repositories' v4 Git refs at implementation time:

| Action | Official v4 ref commit pinned |
|---|---|
| actions/checkout | `11d5960a326750d5838078e36cf38b85af677262` |
| actions/setup-node | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| actions/upload-artifact | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| actions/download-artifact | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |

These are **observed upstream Git commit pins**, not independently human-reviewed code approval. Any future upstream action pin change must receive separate release-owner review.

## Guard and regression coverage

`scripts/check-phase-n70-workflow-safety.cjs` structurally parses all four YAML files; it rejects unknown/moving `uses`, changed commit SHA, narrowed safety events/paths, optional/renamed safety jobs, changed identity/permissions and removed MySQL/VPS recovery commands. `tests/unit/stage70-workflow-safety.test.cjs` supplies positive and 17 adversarial negative cases. `npm run lint` enforces both in Node/Vitest and API/MySQL jobs, in addition to N69's protected signer/prerequisite checks.

## Acceptance and outstanding blockers

- [x] Code, exact source-pin evidence and offline regression tests proposed in N70 branch.
- [ ] PR CI + deployment safety and explicit independent supply-chain action pin review: **PENDING**.
- [ ] Fresh merged-main Windows diagnostic EXE/MSI, tenant-preserving MSI upgrade, universal safety check proof: **PENDING**.
- [ ] Authorized GitHub admin enables non-bypassable main ruleset requiring five original job contexts and independent latest-commit reviewer approval: **PENDING**. This cannot be created by a YAML file and is not yet enabled.
- [ ] Protected signed installer, actual approved package hashes, Hostinger VPS, offsite DB restore and physical Windows customer acceptance: **PENDING**.

**No protected signing or real deployment performed. Production NOT APPROVED.**
