# Phase N Stage 72 — Admin-ready main protection proposal and strict current-code CI requirement

**Status: PROPOSED; CI/PR MERGE PENDING; ACTUAL GITHUB ADMINISTRATION AND PRODUCTION RELEASE NOT APPROVED (2026-11-23 IST).**

## Gap addressed

N71 correctly rejects unprotected `main`, missing review rules and missing trusted statuses, but previously its required-status check evaluation did **not** enforce `strict_required_status_checks_policy=true`, and could accept a union of independently configured strict/loose status rules even when no *single* rule enforced all five required GitHub Actions contexts against the latest target code. That exposed a stale-check approval gap.

Also, the project had no executable reviewed **ruleset proposal** to hand to a real administrator. The user requested every possible code-side completion; this turns the administration blocker into a deterministic offline handoff without granting the CI runner repository admin rights.

## N72 code and verification

- N71 runtime evaluation now requires all five exact GitHub Actions app ID 15368 contexts **together in the same** `required_status_checks` rule with `strict_required_status_checks_policy === true`. A loosely configured or fragmented set of checks fails closed.
- New `scripts/build-phase-n72-main-ruleset.cjs` deterministically emits exact, **non-secret** GitHub REST `POST /repos/{owner}/{repo}/rulesets` JSON: scoped only to `refs/heads/main`, `active` and zero bypass/exclusions, strict latest-code required checks, force-push/deletion denial, one independent latest-push human review, stale dismissal and resolution of threads. No write API, token or network call.
- New `tests/unit/stage72-main-governance-bootstrap.test.cjs` covers the positive policy and 14 adversarial negative/changed-payload fixtures, tests that the CLI works without a token, and denies `--apply`. N71 existing negative fixtures now cover stale policy and fragmented check rules. `npm run lint` executes these on both MySQL-backed test jobs.
- `Enterprise/deploy/MAIN-RULESET-ADMIN-HANDOFF.md` includes the Windows PowerShell local admin instructions and explicit preflight for independent human approver plus platform feature eligibility.
- **Important API caveat:** GitHub may hide ruleset `bypass_actors` from a default read-only Actions token. N71 intentionally denies missing metadata. Do **not** expose an administrator PAT to a general build job to make this pass; the security owner must independently design and approve an adequate privileged verifier/attestation boundary.

## Acceptance evidence

- [x] Implementation and offline tests pushed to an isolated PR branch.
- [ ] PR CI, safety and independent code-review: **PENDING**.
- [ ] Fresh main diagnostic EXE/MSI build/upgrade acceptance: **PENDING**.
- [ ] Live `main` protected ruleset created by authorized administrator with adequate plan; independently reviewed upstream Actions; security-owner approved verification credentials/attestation: **PENDING**.
- [ ] Actual protected code signing, signed publication, Hostinger VPS/DNS/TLS, real customer Windows tenant setup and offsite MySQL restore: **PENDING**.

This is a proposal, not production administration. An effective ruleset requires owner-side action and independent approval. **Production NOT APPROVED.**
