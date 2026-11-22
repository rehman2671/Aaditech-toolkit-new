# Phase N Stage 71 — Fail closed on unprotected main during actual signed EXE/MSI and public GitHub release

**Status: CODE PROPOSED; PR CI + INDEPENDENT SECURITY REVIEW PENDING; LIVE GITHUB MAIN PROTECTION CURRENTLY ABSENT; CUSTOMER PRODUCTION NOT APPROVED (2026-11-22).**

## Highest-risk remaining release gap

Production signing was guarded by `workflow_dispatch`, main branch and a protected environment, but **live GitHub repository governance was not verified before touching the code-signing PFX**. At audit time, `branches/main.protected=false`, the actual rulesets API returned `[]`, and no independent latest-head security review has been recorded. An environment label and synthetic signing tests alone do not prove protected, review-enforced source provenance.

## Actual live guard (no changes to admin settings)

1. `scripts/check-phase-n71-live-release-governance.cjs --live` uses the **read-only** GitHub API with the workflow's existing GITHUB_TOKEN, fixed `api.github.com` origin and main SHA from trusted GitHub event environment. It rejects nonmanual/mismatched source, default-branch drift, current main SHA changes, inactive or missing rulesets, any bypass actor/exclusion, incomplete force-push/deletion prohibitions, absent independent latest-push reviews/stale dismissal/unresolved thread controls, or missing one of the five required status contexts tied to official GitHub Actions app identity `15368`. GitHub API denial/timeout is fail-closed.
2. Real protected `agent-build` now executes the live guard **before** independently approved compiler package download. `Release-Sign.ps1` runs it again during both PrePackage EXE and Finalize MSI signing **before any PFX bytes are read**. Diagnostic push builds exit without reading signing credentials and do not make this network call.
3. `publish-signed-installer.yml` verifies active main protection **before source run acceptance**, requires the human-approved signed source run's SHA equal the publisher's **current main** `GITHUB_SHA`, and rechecks source identity + branch governance before creating a draft and immediately before switching the verified private draft to public.
4. Offline regression tests use synthetic ruleset/branch/reviewer/status metadata and YAML mutations; no real signing keys or GitHub admin calls. Validator `scripts/check-phase-n71-release-policy.cjs` is run by `npm run lint` in Node and API CI jobs.

## Acceptance and external controls

- [x] Live fail-closed code, source SHA rechecks, negative tests and CI guard proposed.
- [ ] PR CI, real Windows PowerShell, MySQL/API and deployment-safety tests; independent security-owner review: **PENDING**.
- [ ] Fresh merged main diagnostic MSI install/upgrade and full CI: **PENDING**.
- [ ] Authorized GitHub admin must activate non-bypassable main ruleset requiring latest-head nonauthor approval, stale dismissal, thread resolution, force-push/deletion prevention and five trusted Actions contexts (issue #62). **NOT DONE by this code**.
- [ ] Real approved signed compiler packages, reviewer certificate and publisher/HSM, protected manual signing, public GitHub Release, Hostinger VPS/DNS/TLS, physical managed Windows rollout and off-host MySQL restoration: **PENDING**.

**Important:** This safeguard **intentionally blocks production signing under the present unprotected repository state**. A synthetic green CI cannot prove that GitHub admin protection has been configured or that a real customer MSI was signed. **Production release NOT APPROVED.**
