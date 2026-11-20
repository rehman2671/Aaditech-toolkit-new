# Phase N Stage 57 — Race-safe project index refresh and metadata provenance

**Status: CODE PROPOSED; CI/PR AND POST-MERGE MAIN ACCEPTANCE PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Verified failure and scope

After the N56 merge (`d5142ccc5d8088cbeac13b0828fe1d9bb616c832`), the
[project index maintenance run 44738371399](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44738371399)
regenerated the three tracked project reports, committed them, then attempted
`git push origin HEAD:main`. The remote `main` had independently advanced
through later acceptance/documentation commits, so Git correctly rejected the
old index commit as **non-fast-forward**. The failure is a metadata-index
publication race, **not** an application, API/MySQL, Windows MSI installation
or deployment-safety failure. N56 post-merge [main CI 4/4](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44738371422)
and [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44738371382)
were already independently successful.

Previous `.github/workflows/project-index-maintenance.yml` regenerated
reports once and pushed without reloading the latest source if main had
changed. The comment incorrectly relied on a subsequent main push being
guaranteed to reconcile a rejected index run; no such guarantee should be
used to mark the maintenance job successful.

## Implementation

`Scripts/Index/Publish-ProjectIndex.sh` becomes the sole CI index
publication entry point. It:

1. Accepts **only GitHub Actions push/manual dispatch on `main`**, starts
   from a clean ephemeral checkout and permits changes to **only**
   `project-index.json`, `project-state.json`, and
   `project-progress.json`.
2. Fetches current `origin/main` and resets only the *ephemeral CI*
   checkout to that exact source commit; neither a working developer tree
   nor the remote branch is ever hard-reset.
3. Runs the existing PowerShell indexer in semantic `-Check` mode. If
   metadata is meaningfully fresh (timestamps and the volatile commit
   identity are excluded by the indexer), exits without a commit. For a
   verified `INDEX CHECK FAILED.` stale result, validates the three
   generated JSON paths and checks that no report marks production ready.
   Unexpected indexer errors or non-report changes fail immediately.
4. Commits and pushes the three regenerated files with the index-bot
   identity and `[skip ci]`. **Never uses force-push or a non-fast-forward
   overwrite.** If the remote moved to a descendant while the index was
   being generated, fetches the new source and **regenerates all three
   reports** rather than rebasing old metadata. The retry limit is four.
5. On a remote permission/network failure without main advancing,
   non-descendant history change, invalid CI context or repeated ongoing
   races, exits nonzero. It never reports a failed publication as success.

The workflow serializes main index maintenance jobs with
`cancel-in-progress: false` rather than cancelling a potentially committing
job midway. Both push and manual dispatch remain main-only; index-bot runs
are still suppressed to avoid generating an infinite commit loop.
`fetch-depth: 0` permits the actual indexer to see complete repository
history rather than a shallow `commit_count=1`.

## Offline regression

`Scripts/Index/Test-Stage57ProjectIndexPublish.sh` constructs a disposable
**local bare Git repository**, an index publisher clone and an independent
competing source-push clone. A synthetic PowerShell indexer with the same
`-Check` semantics generates minimal JSON reports. It verifies:

- A competing change to a tracked source file lands **after the first index
  fetch but before the first push**, triggering a genuine non-fast-forward.
- The helper retries by reloading the **new actual main source** and
  publishes reports whose `last_verified_commit` references the updated
  parent source commit; the competitor commit survives unchanged.
- Repeating maintenance with unchanged meaningful content makes **no**
  new metadata commit.
- Non-main and non-CI invocation are refused.
- A push denied by a local server-side pre-receive hook with **no main
  advancement** is rejected rather than force-pushed or retried forever.

The test has **no access to live GitHub, public DNS, Hostinger, publisher
signing keys, production MySQL or customer data**. It runs on GitHub's
Ubuntu runner with PowerShell 7 as an isolated step in the existing
deployment-safety workflow. That workflow's trigger paths now include
`Scripts/Index/**` and the project-index workflow itself.

## Acceptance and limitations

- [ ] PR isolated Git race/denied-push/no-op regression plus existing
  deployment-safety **2/2** successful; application PR CI **3/3**.
- [ ] Reviewed PR merged, then independently inspected fresh `main`
  index maintenance, diagnostic Windows EXE/MSI **4/4** and deployment
  safety **2/2**.
- [ ] Regenerated project reports on main correspond to the actual newest
  source commit. An index-bot commit will contain only the three
  generated JSON files; never overwrite another commit or imply production
  certification.
- [ ] Actual independently signed N56 reviewer release approval, vetted
  SQLite and publisher fingerprints, protected signed MSI publication,
  real customer Hostinger DNS/TLS, physical Windows queue/ACK and MySQL
  evidence, encrypted offsite restore and human sign-off **PENDING**.

**Production NOT APPROVED.** The index is source metadata, not a release
certificate. See [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).
