# Phase N Stage 69 — Protected Windows signer blocked by ALL security jobs and strict lockfile installs

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; COMBINED MAIN CI 4/4 + SAFETY 2/2 SUCCESS; PRODUCTION SIGNING NOT APPROVED (2026-11-23 IST).**

## Actual protected release hazard

The existing `.github/workflows/ci.yml` protected `agent-build` (same job builds/signs EXE/MSI for `workflow_dispatch`) depended only on `node-tests` and `api-tests`. Therefore a failed or still-running **Windows PowerShell security/signing test suite** did **not** prevent the protected production environment from reaching signing steps. Separately, Node and API CI jobs used `npm ci || npm install`; a lockfile mismatch could silently fall back to a fresh resolver instead of failing the build.

An earlier **draft** integration PR #61 describes this class of issue but is old, unmerged, and lacks independent governance approval. N69 applies a minimal, independently testable fix against current main without merging that broad draft PR.

## Code gate

1. `agent-build.needs` is now **`[powershell-validation, node-tests, api-tests]`**. The protected/manual signing job and diagnostic main MSI cannot start until all three relevant suites succeed. The manual protected `production-installer` environment selection and signed-publication flags remain unchanged.
2. Both Node/Vitest/MySQL and API/MySQL install steps now run **only `npm ci`**. Any drift, missing/corrupt lockfile or network failure blocks CI rather than permitting `npm install` to silently alter package resolution.
3. `scripts/check-phase-n69-ci-release-gates.cjs` uses the existing `yaml` parser to structurally verify the actual workflow: required conditional-free Windows test job, exact protected signer dependencies, event/environment restrictions, signed-artifact upload approval gates, strict `npm ci` and lint in both data jobs.
4. `tests/unit/stage69-ci-release-gates.test.cjs` supplies offline adversarial YAML mutations (removed/conditional Windows gate, altered job identity, npm fallback, missing release environment, broadened event access, removed signed-upload approval and malformed YAML). Both Node jobs execute validator and tests through `npm run lint`.

## Acceptance and immutable external blockers

- [x] Narrow code and negative tests authored on isolated N69 branch. No signing keys or real customer server accessed.
- [x] [PR #69](https://github.com/rehman2671/Aaditech-toolkit-new/pull/69) merged at `da257add011f564793e853041b08475e621c92af` after [PR CI #45052621206](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45052621206) **3/3 SUCCESS** and [PR safety #45052621208](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45052621208) **2/2 SUCCESS**.
- [x] Combined merged main N68-N70 [CI #45055096722](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45055096722) **4/4 SUCCESS** with Windows EXE/MSI diagnostic install/uninstall/tenant-preserving upgrade; [safety #45055096741](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45055096741) **2/2 SUCCESS**. Protected manual signing and signed publication were correctly skipped.
- [ ] Live non-bypassable main ruleset, independent latest-commit approving review and the required GitHub Actions status contexts: **PENDING authorized repository administrator**. Repository governance cannot be established by CI YAML or auto-merging.
- [ ] Real independently approved compiler/SQLite hashes, reviewer-signed release manifest, publisher signing certificate, protected manual release, GitHub public release, Hostinger VPS/DNS and customer Windows/offsite MySQL acceptance: **PENDING**.

**Threat boundary:** This prevents a known GitHub Actions scheduling bypass. It is not an actual human review or GitHub branch protection rule. No manual signing/public release was triggered. **Customer production NOT APPROVED.**
