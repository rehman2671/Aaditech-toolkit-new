# Phase N Stage 60 — Private draft release identity and Git tag lifecycle

**Status: CODE PROPOSED; PR CI / POST-MERGE MAIN ACCEPTANCE PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Confirmed release-blocking N59 gap

Phase N59 introduced mandatory GitHub-hosted SHA256/size attestation
before publishing an installer draft. Its remote verifier, however,
**assumed that a private GitHub draft has already created the remote
`refs/tags/<tag>` Git reference** and attempted to fetch the draft
using `GET /repos/{owner}/{repo}/releases/tags/{tag}`. Neither
assumption is reliable: GitHub creates a pending release tag only
when publishing a new draft, and the REST by-tag lookup does not
expose draft releases. The first real protected draft upload
would therefore fail at the N59 prepublication admission step,
despite a correctly signed and independently approved installer.

GitHub references:
[GitHub release drafts](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository),
[GitHub CLI release view fields](https://cli.github.com/manual/gh_release_view),
[GitHub CLI draft resolution](https://pkg.go.dev/github.com/cli/cli/v2/pkg/cmd/release/shared).

**This was an unexercised production path flaw identified by
review, not evidence of a compromised, published release.**

## Implementation

1. `.github/workflows/publish-signed-installer.yml` still rejects an
   existing tag before creating anything and still creates an
   unpublished draft with the reviewed source SHA. After a successful
   `gh release create --draft`, it resolves the newly created draft
   via `gh release view <tag> --json databaseId,isDraft,tagName,targetCommitish`.
   GitHub CLI can resolve *drafts* using its fallback discovery,
   whereas REST by-tag lookup cannot. The positive numeric
   `databaseId`, exact pending tag, source SHA and `isDraft=true`
   become explicit admission inputs.
2. All three N59 hosted-asset checks (first draft check, second draft
   check **immediately before** publication, and published check)
   now use that **same original numeric GitHub release ID**:
   `GET /repos/{owner}/{repo}/releases/{id}`. N59's offline asset
   module requires `ExpectedReleaseId` and rejects any response
   with a different ID, even when the asset names/hashes and pending
   tag happen to be otherwise valid.
3. `ReleaseTagLifecycle.psm1` distinguishes the two legitimate tag
   states. A draft's authenticated matching-refs API must show
   **no exact release tag**. After the validated
   `gh release edit --draft=false`, the GitHub tag must
   **exist as one exact lightweight commit ref**, not an annotated
   tag object, and resolve to the same human-approved signing SHA.
   Missing, moved, duplicate, noncanonical, prefixed or untrusted
   refs fail closed. Related-prefix tag names are not mistaken for
   the exact intended tag.
4. `Assert-RemoteReleaseAssets.ps1` uses
   `GET /git/matching-refs/tags/<tag>` rather than fetching a
   nonexistent exact draft tag (HTTP 404). An API failure is still a
   hard failure; it is **not** conflated with a confirmed empty `[]`
   ref result. Draft and published state both retain the same
   N56/N58 reviewer-signature and SQLite/publisher approval gates,
   N59 three-asset SHA256 byte-for-byte check, and operator-approved
   MSI fingerprint.

If GitHub changes the API semantics or the required draft ID or
hosted digest cannot be established, the protected workflow blocks
rather than weakening its approval or claiming release success.
N60 does not create a tag in advance, mutate a draft on failure,
force-push, auto-delete partially staged assets, or publish an
unsigned diagnostic installer.

## Windows synthetic regression

`Enterprise/tests/Test-Stage60DraftTagLifecycle.ps1` runs on
**Windows PowerShell 5.1 and 7**, with no live GitHub operations.
It validates:

- Empty actual Git refs `[]` are correct **for a draft only**.
- Exact `refs/tags/agent-v...-r...` matching the authorized source
  SHA and commit type is correct **for a published release only**.
- Wrong SHA, annotated tag, duplicate exact refs, malformed JSON,
  object instead of array, wrong release lifecycle mode and related
  prefix-only tags cannot bypass the validator.
- Staging order is `gh release create --draft`, obtaining
  `gh release view` numeric ID, two authenticated matching-ID draft
  asset checks, independent N56 reviewer and MSI rechecks, public
  `gh release edit`, then *published* tag + asset checks.
- Earlier N59 fake GitHub hosted-asset tests now require the original
  numeric `ExpectedReleaseId` and reject a different API response ID.

Tests do **not** create or publish a GitHub release, call live
customer Hostinger, load publisher keys or generate production
reviewer signatures.

## Acceptance and remaining blockers

- [ ] PR N60/N59 tests on Windows PowerShell 5.1/7 plus earlier
  security regressions, Node/Vitest+MySQL and API/MySQL **3/3**;
  deployment safety **2/2**.
- [ ] Reviewed PR merged; independent fresh `main` Windows EXE/MSI
  build, extraction, install/clean uninstall and configuration-preserving
  major upgrade **4/4**, deployment safety **2/2**, index refresh
  successful.
- [ ] Real independently vetted SQLite ZIP/EXE fingerprints, approved
  publisher certificate/HSM, exact short-lived N56 reviewer-signed
  source manifest, protected manual signing run and actual private
  draft-to-public release with remote tag/asset verification **PENDING**.
- [ ] Customer Hostinger DNS/TLS, physical Windows enrollment and lost
  ACK replay, live tenant/MySQL receipts, encrypted offsite restore and
  authorized security/release-owner acceptance **PENDING**.

**Customer production NOT APPROVED.** The protected manual publication
has not been exercised with genuine signer/reviewer credentials.
See [production checklist](PHASE-N-PRODUCTION-RELEASE-CHECKLIST.md)
and [release security tracker #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Earlier independently verified baseline

N59 [post-merge `main` CI 44754917612](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754917612)
**4/4 SUCCESS**, [safety 44754917539](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754917539)
**2/2 SUCCESS**. N59 final documentation-push
[CI 44756044012](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44756044012)
**4/4 SUCCESS**, [safety 44756044018](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44756044018)
**2/2 SUCCESS**, [index 44756044118](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44756044118)
**SUCCESS**. These are pre-N60 checks and do not establish
a protected live customer signing release.
