# Phase N Stage 71 — Protected main policy verified live before any production signing or public GitHub Release

**Status: IMPLEMENTATION PROPOSED; PR CI/REVIEW PENDING; NO PRODUCTION SIGNING, LIVE HOSTINGER, CUSTOMER DEPLOYMENT OR RELEASE APPROVAL (2026-11-23 IST).**

## Actual remaining gap

At last live GitHub inspection, `main` reported **`protected=false`**, repository rulesets were **empty** and code-signing workflows depended on manual `production-installer` environment admission and reviewed manifest values but not on a **fresh read-only assertion that the repository itself enforces non-bypassable independent source reviews and trusted required checks**. Even with the N68–N70 diagnostic suites green, a protected signing workflow must not proceed in an unprotected repository.

The existing unreviewed historical draft integration PR #61 contains related concepts, but it was **not** merged or treated as an authorization. N71 applies a deliberately narrow, tested gate to current main, retaining the N56/N58 original signed reviewer approvals, N63 independently SHA-approved package provenance and N70 exact GitHub Actions pins.

## Implementation

1. New `scripts/check-phase-n71-live-main-protection.cjs` uses only built-in Node `fetch` and HTTPS GitHub REST API reads, no third-party runtime modules. It checks the **current** repository and `main` commit SHA against the manually dispatched GitHub workflow `GITHUB_SHA`, active applicable GitHub branch ruleset(s), absence of bypass actors and exclusions, required PR reviews (at least one, dismiss stale, latest-push independent approval, unresolved-thread blocking), force-push/deletion prevention, and all **five** required job contexts explicitly bound to GitHub Actions app ID **15368**. Missing HTTP permission, invalid/incomplete API data, wrong repo/ref/event/token or unprotected main **block**.
2. `.github/workflows/ci.yml` calls that live gate **before protected compiler download** and after real MSI extraction before final signing, only for manual main dispatch. `Release-Sign.ps1` also calls the same verifier independently at **both PrePackage and Finalize** after nonsecret thumbprint validation but **before decoding/importing any PFX**. Ordinary push diagnostic builds remain unsigned and do not perform live checks.
3. `.github/workflows/publish-signed-installer.yml` runs live protected-main gate **before source provenance validation**, and again just before creating a hidden draft and immediately before making that draft public. Its approved signed CI `head_sha` must equal both the independent `approved_source_sha` and this publisher dispatch's `GITHUB_SHA`; subsequent source checks repeat immediately before release. If main advanced or protections were disabled, publication fails closed without automatically deleting private drafts.
4. `scripts/check-phase-n71-release-workflow.cjs` verifies full YAML signer/approval/token/step ordering and pre-PFX admission, while offline `tests/unit/stage71-live-main-protection.test.cjs` and `tests/unit/stage71-release-workflow.test.cjs` test unsafe branch ruleset settings, missing trusted check IDs, metadata mismatch and signing/publishing bypass mutations. Both MySQL-backed Node CI jobs execute all guards through `npm run lint`.

## Acceptance and external boundaries

- [x] N71 code, negative offline tests and protected workflow wiring proposed on branch `fix/phase-n71-live-protected-release-gates`.
- [ ] Current N71 PR PowerShell/Node/API/MySQL + universal safety CI: **PENDING**.
- [ ] PR merge, fresh main Windows **diagnostic** EXE/MSI build, extraction/install/uninstall and tenant-preserving major upgrade: **PENDING**.
- [ ] Actual GitHub administrator activates and verifies non-bypassable **main ruleset**, required five check contexts from official GitHub Actions app and independent reviewer approvals: **PENDING**. Currently unprotected main must be **DENIED** by this new live gate.
- [ ] Real independently reviewed package/SBOM checks, original reviewer signing, cert/HSM, signed GitHub Release, actual Hostinger VPS/DNS/ACME, physical Windows tenant enrollment and encrypted offsite MySQL restore: **PENDING**.

**No protected signing or public publication was triggered. Code/CI controls cannot invent human GitHub governance approval; production remains NOT APPROVED.**
