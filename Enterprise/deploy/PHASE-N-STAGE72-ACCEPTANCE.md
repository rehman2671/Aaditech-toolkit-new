# Phase N Stage 72 — Admin-ready main protection proposal and strict current-code CI requirement

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; FRESH MAIN DIAGNOSTIC WINDOWS MSI CI 4/4 + SAFETY 2/2 SUCCESS; GITHUB ADMINISTRATION/PRODUCTION NOT APPROVED (2026-11-23 IST).**

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

- [x] [PR #74](https://github.com/rehman2671/Aaditech-toolkit-new/pull/74) merged as `953566b4f2854d9d64fc0f11ae5c701974825fe7` after exact-head [PR CI #45062081506](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45062081506) **3/3 SUCCESS** (Windows PowerShell, Node/Vitest+MySQL, API+MySQL) and [PR deployment safety #45062081546](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45062081546) **2/2 SUCCESS** (Bash/offline + isolated real MySQL backup/restore).
- [x] [Fresh merged-main CI #45062353330](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45062353330) **4/4 SUCCESS** at N72 merge SHA: PowerShell tests, Node/MySQL, API/MySQL, real Windows diagnostic EXE/MSI build, MSI administrative extraction, actual install/post-setup/clean uninstall and tenant-configuration-preserving major upgrade. [Main safety #45062353339](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45062353339) **2/2 SUCCESS**.
- [x] Protected manual main ruleset admission, independently SHA-approved NUPKG package installation, actual Authenticode signing, signed publication verification and artifact upload were **SKIPPED** in diagnostic CI. No fake production approval inferred.
- [ ] Independent security-owner code review of the proposed ruleset, active GitHub admin enforcement and bypass metadata permission boundary: **PENDING**.
- [ ] Live `main` protected ruleset created by authorized administrator with adequate plan; independently reviewed upstream Actions; security-owner approved verification credentials/attestation: **PENDING**.
- [ ] Actual protected code signing, signed publication, Hostinger VPS/DNS/TLS, real customer Windows tenant setup and offsite MySQL restore: **PENDING**.

This is a proposal, not production administration. An effective ruleset requires owner-side action and independent approval. **Production NOT APPROVED.**
