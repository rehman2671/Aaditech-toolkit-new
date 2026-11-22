# Phase N Stage 73 — Complete GitHub governance ruleset enumeration

**Status: CODE PROPOSED / PR validation pending (2026-11-23 IST). Production signing and deployment NOT APPROVED.**

## Gap and security boundary

N71's live production-signing verifier previously read only the first default GitHub REST ruleset page. A repository with enough policies to paginate could hide an additional effective `main` ruleset (including a bypass actor) beyond the first page. Passing N71 on incomplete policy enumeration is not a valid production authorization.

N73 replaces first-page-only reads with bounded, exact GitHub REST pagination: 100 entries per page, no implicit truncation, per-page and page parameters explicit, fail-closed on an unexpected page response, invalid or repeated ruleset IDs, more than ten full pages, HTTP permission failures, and mismatched details. Rule details are fetched in groups of ten to avoid unlimited parallel API calls. Existing N71 strict independent reviewer and all-five-check policy remains unchanged.

Offline `node --test tests/unit/stage73-ruleset-pagination.test.cjs` verifies a hidden second-page bypass denial, duplicates/malformed IDs, inconsistent details, 403 on a subsequent page, over-limit refusal, and a complete valid single-page policy. `npm run lint` includes these tests so the existing Node CI jobs execute them.

## Live acceptance (not satisfied by this code change)

- [ ] Exact PR head full CI and deployment-safety jobs green; merge only after review.
- [ ] Fresh merged-main diagnostic Windows MSI and safety checks green.
- [ ] Authorized repository administrator applies an independently reviewed **active** `main` ruleset with no bypass and five strictly current official Actions checks.
- [ ] A release-security owner resolves privileged read access to `bypass_actors` without sharing an administration-write token with general CI.
- [ ] Independently approved signing archives, real signed release, Hostinger HTTPS + MySQL, physical Windows enrollment and encrypted offsite restore are verified with operator receipts.

N73 deliberately does not change GitHub settings, provision credentials, claim signed artifacts, or trigger a production deployment. See [admin handoff](MAIN-RULESET-ADMIN-HANDOFF.md) and [production checklist](PHASE-N-PRODUCTION-RELEASE-CHECKLIST.md).
