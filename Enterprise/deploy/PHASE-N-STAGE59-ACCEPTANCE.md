# Phase N Stage 59 — Private draft staging and GitHub-hosted release asset attestation

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; FRESH MAIN DIAGNOSTIC EXE/MSI 4/4 + SAFETY 2/2 SUCCESS; INDEX VERIFIED; PROTECTED SIGNED PRODUCTION RELEASE PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Security gap and release trust boundary

N56/N58 already validate the *original independently signed reviewer
authorization* (exact Git SHA, version, MSI revision, publisher certificate
and vetted SQLite dependency hashes) and recheck the actual signed agent
EXE/MSI, embedded SQLite and first-run blank configuration. The separately
dispatched GitHub release workflow then called `gh release create` with
three local verified assets. Without an explicit draft-and-remote-attest
step, the command may publish after its own uploads without comparing
the final GitHub-hosted asset SHA-256 digests and byte lengths against
the independently approved local bytes. An incomplete or mismatched
remote release asset set was not a separate fail-closed publication gate.

N59 **does not** replace any N54–N58 approval; it adds a new boundary
between staging and publicly exposing a signed installer. This was a
code-level defense-in-depth finding, not evidence of any observed public
tampering or an existing customer release.

## Implementation

1. `.github/workflows/publish-signed-installer.yml` now creates a
   **draft** with `gh release create --draft --target <approved source SHA>`
   instead of immediately publishing a release. Concurrency is serialized
   by exact release tag with `cancel-in-progress: false`; a second
   publisher cannot interrupt the first while its draft is being staged.
   Existing-tag checks remain fail-closed.
2. `Enterprise/agent/build/ReleaseAssetAttestation.psm1` accepts only a
   bounded JSON response from the authenticated GitHub Release API and
   exactly **three assets**: `IT-Toolkit-Agent.exe`,
   `IT-Toolkit-Agent-<version>.msi` and `SHA256SUMS.txt`. It verifies
   exact nonduplicate filenames, `state=uploaded`, positive asset IDs,
   exact **asset size** and required `digest=sha256:<64 lowercase hex>`
   for each asset, comparing every hosted digest with a fresh hash of
   the corresponding local file. It rechecks N55's exact canonical
   two-line manifest and the **independently approved MSI hash**. Any
   missing/unsupported digest is a hard fail, not an implicit pass.
3. `Enterprise/agent/build/Assert-RemoteReleaseAssets.ps1` is a narrow,
   read-only authenticated bridge to GitHub API: it requires protected
   manual `main` CI context, approved source SHA and approved MSI
   fingerprint. It checks `refs/tags/<release-tag>` is an actual
   **lightweight commit ref** pointing to the exact approved source and
   verifies the GitHub release object's exact tag, `target_commitish`,
   `prerelease=false` and **draft or published** state. No private
   signing key is handled by this verifier.
4. After staging the draft, the workflow checks remote asset digests,
   revalidates the **same original N56 reviewer signature** and
   EXE/MSI/embedded SQLite payload again in case approval expired during
   upload, and rechecks hosted digests **immediately before**
   `gh release edit --draft=false`.
5. A final post-publish GitHub API verification requires
   `draft=false`, nonempty `published_at`, correct tag-to-source
   commit and unchanged three hosted asset digests. A successful CLI
   status alone is never treated as release acceptance.

**Fail-closed behavior:** If staging, signature/payload rechecks,
GitHub API response, SHA metadata, tag pointer or public transition
fails, the workflow exits nonzero and never intentionally publishes an
unverified draft. A failed step after a draft was created may leave a
**private/unpublished draft and tag requiring manual security-owner
review**; it must not be auto-deleted, force-pushed, silently overwritten
or approved on retry. If a post-publish recheck fails, this is a release
incident requiring security-owner action (not a claim of automatic
rollback or zero exposure).

GitHub's REST API exposes a release asset `digest` with
`sha256:<hex>`; GitHub CLI supports draft creation and explicit
`--draft=false` publication. See
[GitHub release asset API](https://docs.github.com/en/rest/releases/assets),
[GitHub Release CLI](https://cli.github.com/manual/gh_release_create),
and [GitHub draft release editing](https://cli.github.com/manual/gh_release_edit).
Repository-level **immutable releases** should also be enabled by
the authorized GitHub owner after reviewing repository policy; N59
does **not** change repository settings or guarantee future immunity
from privileged administrative actions.

## Offline Windows regression

`Enterprise/tests/Test-Stage59DraftReleaseAttestation.ps1` runs on
**Windows PowerShell 5.1 and 7**, using only synthetic unsigned EXE/MSI
bytes, a canonical SHA256SUMS and fake GitHub JSON responses. It proves
the offline attestation accepts correct drafts and complete published
releases, and rejects:

- Partial, extra, duplicate or unexpected asset names.
- Incorrect/empty/noncanonical digest; wrong size, invalid asset ID,
  incomplete upload state, mutated MSI and checksum manifest.
- Wrong independently approved MSI digest, Git source SHA, tag, draft/
  published state, prerelease status and publication timestamp.
- Incorrect workflow ordering: staged **draft first**, two verified
  remote SHA gates, reauthenticated reviewer approval/payload before
  public `gh release edit`, and a final published SHA verification.
- Missing release-tag concurrency and GitHub tag-ref/source provenance.

The tests **never** call `gh release create`, issue signing keys, publish
a tag or access customer endpoints.

## Acceptance

- [x] PR PowerShell 5.1/7 N59 tests plus N31–N58,
  Node/Vitest+MySQL and API/MySQL **3/3 SUCCESS**, deployment safety
  **2/2 SUCCESS**.
- [x] Reviewed [PR #54](https://github.com/rehman2671/Aaditech-toolkit-new/pull/54)
  merged as `ff86c5517150461a1fd55b5fc96072f387756286`.
  Fresh `main` diagnostic Windows EXE/MSI build, administrative extraction,
  real install/clean uninstall and tenant-preserving major upgrade
  **4/4 SUCCESS**, safety **2/2 SUCCESS**, index maintenance success.
- [ ] Independently reviewed production publisher/HSM key custody,
  SHA-approved authentic SQLite ZIP/EXE, actual N56 reviewer-signed
  24-hour release scope, successful protected CI signed run and
  **protected draft/upload/remote SHA/public transition** exercised in
  GitHub with independently pinned MSI hash — **PENDING**.
- [ ] Real Hostinger DNS/TLS, Windows customer device online enrollment,
  lost-ACK/tenant queue receipts, MySQL replay, encrypted offsite restore,
  authorized release owner and security owner sign-off — **PENDING**.

**Production NOT APPROVED.** Diagnostic automatic push builds intentionally
skip protected signing and signed artifact upload. No genuine publisher,
reviewer private key, live customer DB, physical machine or real GitHub
Release was used in N59 offline tests.

See [production checklist](PHASE-N-PRODUCTION-RELEASE-CHECKLIST.md)
and [security tracker #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Previous verified baseline

[N58 main CI 44748922171](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748922171)
was **4/4 successful**, and
[N58 main safety 44748922199](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748922199)
**2/2 successful**. The later documentation-only
[CI 44750192938](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44750192938)
was also **4/4 successful**, safety
[44750193033](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44750193033)
**2/2 successful** and index
[44750192999](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44750192999)
**successful**. These are pre-N59 baselines, not proof of the
manual production publication path.

## Verified PR and post-merge GitHub acceptance

- [PR #54](https://github.com/rehman2671/Aaditech-toolkit-new/pull/54)
  head `4095d3cd486cbfabf4cc0390298c980765dd887d`,
  merge `ff86c5517150461a1fd55b5fc96072f387756286`.
- [PR CI 44754414735](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754414735):
  **3/3 SUCCESS**; Windows PowerShell 5.1/7 N59 local fake-release
  SHA/size/draft/publication regressions, N31–N58, Node/Vitest+MySQL
  and API/MySQL. PR MSI build intentionally skipped.
- [PR deployment safety 44754414651](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754414651):
  isolated MySQL backup/restore and offline recovery **2/2 SUCCESS**.
- Fresh post-merge [main CI 44754917612](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754917612):
  **4/4 SUCCESS**; Windows PowerShell, Node/Vitest+MySQL, API/MySQL,
  real Windows EXE and WiX MSI build, administrative extraction,
  actual MSI setup/clean uninstall and major upgrade preserving tenant
  configuration all successful.
- [Main safety 44754917539](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754917539):
  **2/2 SUCCESS**. [Main index maintenance 44754917638](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754917638):
  **SUCCESS**, generating index-only bot commit
  `3725e3f56f33469825e80f83bdb3238b64ab5048` from merged N59 source.
- Expected on unsigned push: `Verify final signed artifact publication`
  and `Upload verified signed artifacts only` both **SKIPPED**.
  The separate protected GitHub Release workflow and its new N59
  actual hosted draft/pub verification were **not executed** because
  independent publisher/reviewer approval and signed-source inputs
  have not been supplied. This is **not** a production acceptance.
