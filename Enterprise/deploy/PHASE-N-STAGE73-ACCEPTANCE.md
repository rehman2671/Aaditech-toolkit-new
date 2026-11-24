# Phase N Stage 73 — Complete and consistent live governance reads

**Status: CODE AND REGRESSION FIXTURES READY; CI AND INDEPENDENT REVIEW PENDING; PRODUCTION NOT APPROVED (2026-11-25 IST).**

## Scope and implementation

N71/N72 read the first GitHub ruleset-list response without following pagination. They also read main only before fetching policy details. N73 hardens these read boundaries:

- Fetch every bounded page of repository and inherited rulesets from the fixed GitHub API origin; never follow a remote Link URL, reject redirects, request uncached data, and fail closed on repeated/invalid IDs, malformed or nonterminal empty pages, API errors, or exceeding the five-page cap.
- Fetch details in bounded batches and reject mismatched IDs or missing rule arrays.
- Re-read all ruleset IDs after detail retrieval and reject membership changes; re-read main and reject branch name, protected-state or commit drift.
- Existing N71/N72 policy checks, manual-only release guard, no-bypass requirements and independent approval remain unchanged. No extra credentials or repository settings mutation is introduced.

The read is not an atomic GitHub policy snapshot: same-ID ruleset edits during a read are not fully detectable. The existing repeated release-boundary checks and human-controlled protection remain mandatory.

## Acceptance

- [x] Implementation and synthetic regression fixtures added to the existing N71 test file dispatched by npm run lint.
- [ ] Verify exact-head CI including pagination, fixed-origin/redirect options, second-page bypass, invalid/repeated IDs, detail mismatch, membership and branch drift, pagination cap, empty next page and later-page API failure.
- [ ] Independent review and merge; fresh main diagnostic MSI and deployment safety jobs.
- [ ] Authorized admin activation and independent governance verification; no admin PAT in general CI.
- [ ] Protected signed release, real Hostinger VPS/DNS/TLS, physical Windows enrollment and independent encrypted offsite MySQL restore remain blocked.

No live policy, signing, publishing, deployment or customer acceptance is asserted by this stage.
