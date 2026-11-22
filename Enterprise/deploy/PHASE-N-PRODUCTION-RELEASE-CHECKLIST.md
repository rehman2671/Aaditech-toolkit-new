# Phase N — Production release acceptance and sign-off

## Stage N67 — signed installer configuration is strictly generic (MERGED; PR 3/3 + SAFETY 2/2; MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2; PRODUCTION BLOCKED)

- [x] Every external/embedded signed release JSON must have exact first-run fields and proper JSON data types. Reject extra keys, duplicate keys, credentials/server URL, nonempty script allowlist, mismatched version/interval and any feature/elevation/script discrepancy from the source-controlled manifest.
- [x] N67 admission is wired to final Authenticode-protected publication verifier (external agent-config.json and ALL extracted agent.json payloads) and to pre-compiler generic MSI CI staging; synthetic PowerShell 7 regressions added.
- [x] [PR #67](https://github.com/rehman2671/Aaditech-toolkit-new/pull/67) merged as `462b41b9b000b299ad5458fbd3ec155e98809cf7` after [PR CI #45050758426](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45050758426) **3/3 SUCCESS** and [PR safety #45050758376](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45050758376) **2/2 SUCCESS**.
- [x] [Fresh main CI #45051039313](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45051039313) **4/4 SUCCESS** at merge SHA `462b41b9b000b299ad5458fbd3ec155e98809cf7`: real N67 generic-config preflight, Windows PowerShell, Node/MySQL, API/MySQL, diagnostic Windows EXE/MSI build, MSI administrative extraction, install/post-setup/clean uninstall and tenant-preserving major upgrade. [Main safety #45051039322](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45051039322) **2/2 SUCCESS**.
- [x] Protected independently approved N63 package install, final signed publication verification and signed artifact upload were **SKIPPED**, not passed, in diagnostic CI.
- [ ] Independent manual signing authority, approved archive checks, protected signing, actual Hostinger VPS/Windows/customer rollout and offsite restore evidence: **PENDING**.

See [N67 acceptance](PHASE-N-STAGE67-ACCEPTANCE.md).

## Stage N66 — protected WiX shim and tool-store continuity (MERGED; PR CI 3/3 + SAFETY 2/2; MAIN SAFETY 2/2 + INDEX PASS; MAIN MSI 4/4 SUCCESS; PRODUCTION BLOCKED)

- [x] After N63's independently SHA-approved, N65-screened local NuGet restore, capture SHA-256 identity for the exact Windows global `wix.exe` shim and every installed file/directory in the locked `.dotnet/tools/.store/wix/<version>` tree.
- [x] Protected `Assert-N62InstalledWix` rejects alternate PATH commands, reparse paths, changed shim bytes or modified/missing/extra dependencies before running even `wix --version`; diagnostic CI remains unsigned/version-pinned.
- [x] N66 Windows PowerShell 5.1/7 negative mutation tests both **PASS**. [PR #66](https://github.com/rehman2671/Aaditech-toolkit-new/pull/66) merged at `4fbf22ddbd601e266b437911b768751ccd43b4b4` after [PR CI #45027987884](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45027987884) **3/3 SUCCESS** and [PR safety #45027987875](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45027987875) **2/2 SUCCESS**.
- [x] [Main safety #45028218021](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45028218021) **2/2 SUCCESS** and [index #45028217998](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45028217998) **SUCCESS**.
- [x] [Fresh main CI #45028218016](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45028218016): **4/4 SUCCESS** at N66 merge SHA `4fbf22ddbd601e266b437911b768751ccd43b4b4`, including genuine diagnostic Windows EXE/MSI compilation, administrative extraction, Windows install/post-setup/clean uninstall, and tenant-preserving major upgrade. Protected N63 approved-archive install, final signed release gate and upload were **SKIPPED** (not verified).
- [ ] Independent security-owner acceptance, protected real approved-NUPKG install and signed MSI publication: **PENDING**.
- [ ] Hostinger domain/VPS deployment, actual Windows devices and offsite MySQL restore/operator approvals: **PENDING**.

See [N66 acceptance](PHASE-N-STAGE66-ACCEPTANCE.md).

## Stage N65 — approved compiler NUPKG ZIP-entry safety (MERGED; PR CI 3/3 + SAFETY 2/2; MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2; PRODUCTION BLOCKED)

- [x] Read-only ZIP entry preflight is added after independently approved N63 package SHA verification and before any PS2EXE extraction or WiX local-only restore. Windows traversal, archive ambiguity, symlink/reparse entries and decompression bombs fail closed; the copied PS2EXE ZIP is rehashed against the original approved SHA immediately before extraction.
- [x] N65 synthetic archive negative tests **PASS** on real Windows PowerShell 7 and 5.1. [PR #65](https://github.com/rehman2671/Aaditech-toolkit-new/pull/65) merged as `e52bd5652d580cf031413ab05f0546afdeb96299` after [PR CI #45026179982](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026179982) **3/3 SUCCESS** and [PR safety #45026179985](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026179985) **2/2 SUCCESS**.
- [x] [Fresh main CI #45026463843](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026463843) **4/4 SUCCESS** including actual diagnostic EXE/MSI build, administrative extraction, real Windows post-setup clean install/uninstall, and tenant-preserving major upgrade; [main safety #45026463832](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026463832) **2/2 SUCCESS** and [index #45026463839](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45026463839) **SUCCESS**. Protected independently approved package install, signed artifact verification and public upload **SKIPPED**, not passed.
- [ ] Separate security-owner acceptance and protected production release **PENDING**.
- [ ] Independently approved real PS2EXE/WiX NUPKG bytes, protected live manual installation, publisher/HSM certificate signing, reviewer release authorization, actual Hostinger/customer/physical Windows/offsite MySQL evidence: **PENDING**. No public signed MSI has been released.

See [N65 acceptance](PHASE-N-STAGE65-ACCEPTANCE.md).

## Stage N64 — protected compiler module tree continuity (MERGED; PR CI 3/3 + SAFETY 2/2; MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2; PRODUCTION BLOCKED)

- [x] The protected PS2EXE installation now hashes the entire independently reviewed N63 archive's extracted module tree (names, lengths, files, nested dependencies and directory entries) and compares the complete installed tree. A matching `ps2exe.psd1` alone is not sufficient; edited `ps2exe.psm1`, stale/extra files and missing companions fail closed.
- [x] The approved installed tree fingerprint is carried through the protected job and checked again **before** `build-agent.ps1` imports PS2EXE, with explicit N63 module path and N62 pinned version still enforced. Diagnostic builds remain nonpublishable.
- [x] PowerShell 5.1/7 synthetic N64 tamper, added/removed dependencies and pre-import SHA continuity regressions **PASS**. [PR #64](https://github.com/rehman2671/Aaditech-toolkit-new/pull/64) merged as `80334a42e86311b24e13e69845f047043092c7dc` after [PR CI #45022600248](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022600248) **3/3 SUCCESS** and [PR safety #45022600246](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022600246) **2/2 SUCCESS**.
- [x] [Fresh main CI #45022858422](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022858422) **4/4 SUCCESS**, including genuine diagnostic EXE/MSI build, extraction, Windows clean install/uninstall, tenant-preserving major upgrade; [main safety #45022858450](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022858450) **2/2 SUCCESS** and [index #45022858434](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45022858434) **SUCCESS**. Protected signing, publish verification and artifact upload were **SKIPPED**, not passed.
- [ ] Separate security-owner review and authenticated protected manual signed-publication acceptance **PENDING**.
- [ ] All original owner-supplied N63 archive SHA approvals, real protected package installation, publisher signing, release approval, Hostinger, customer Windows and offsite database restore evidence remain **PENDING**. **Customer production NOT APPROVED.**

See [N64 acceptance](PHASE-N-STAGE64-ACCEPTANCE.md) and [tracked release blockers #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N63 — independently SHA-approved compiler archives before protected execution (MERGED; PR CI 3/3 + SAFETY 2/2; FRESH MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2, INDEX VERIFIED; REAL PROTECTED RELEASE PENDING)

- [x] The code requires **independent security-owner reviewed SHA256** of `ps2exe.1.0.18.nupkg` and `wix.5.0.2.nupkg` from separately protected `production-installer` environment secrets `PS2EXE_NUPKG_SHA256_APPROVED` and `WIX_NUPKG_SHA256_APPROVED`. No approved real hashes have been invented; owner provisioning and live protected acceptance **PENDING**.
- [x] Protected `workflow_dispatch` main CI now requires **both fingerprints before package download** and verifies exact-version bounded NUPKG bytes before extraction or installation. PS2EXE imports from the SHA-vetted module path; WiX installs from an isolated local-only reviewed NuGet archive and fresh package cache. Missing pins or wrong manual context refuse use of fallback public packages. Diagnostic `push` stays unsigned/unpublishable.
- [x] Windows PowerShell 5.1/7 N63 package identity/tamper/size/approval-context and N31–N62 regressions [PR CI 44825229841](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825229841) **3/3 SUCCESS**, [PR safety 44825229888](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825229888) **2/2 SUCCESS**; reviewed [PR #58](https://github.com/rehman2671/Aaditech-toolkit-new/pull/58) merged as `053788a2670ee66b229e50da6c6634bca3fb1126`. Fresh [main diagnostic MSI 44825709437](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825709437) **4/4 SUCCESS** with extraction/real install/clean uninstall/tenant-preserving major upgrade; [main safety 44825709377](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825709377) **2/2 SUCCESS**, [index 44825709447](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44825709447) **SUCCESS**.
- [ ] Actual independently vetted compiler archives and provisioned secrets, N56 original signed reviewer approval, publisher/HSM code signing, approved SQLite executable/archive, real protected GitHub draft-to-public release and Hostinger/physical Windows tenant/ACK/MySQL/restore receipts remain **PENDING**. Package version and hash admission alone **do not approve production**.

See [N63 acceptance](PHASE-N-STAGE63-ACCEPTANCE.md) and [tracked release blockers #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N62 — exact Windows compiler toolchain versions (MERGED; PR CI 3/3 + SAFETY 2/2, MAIN PINNED EXE/MSI 4/4 + SAFETY 2/2 AND INDEX VERIFIED; PRODUCTION BLOCKED)

- [x] Replaced floating `Install-Module ps2exe` and `dotnet tool install wix --version "5.*"` with **exact** PS2EXE **1.0.18** (PSGallery) and WiX **5.0.2** (NuGet), held in a strict checked-in toolchain lock. No fallback to latest in protected or diagnostic CI builds.
- [x] Actual PS2EXE command's loaded module version is checked before EXE compilation and the actual WiX CLI `--version` before MSI building, including direct local entrypoints; mismatched versions fail closed. These pins **do not independently certify remote package ZIP/SHA/signature** or replace reviewer/Authenticode approval.
- [x] N62 downgrade/upgrade/floating/injection and build-step-order tests plus N31–N61 **Windows PowerShell 5.1 and 7**, Node/Vitest+MySQL, API/MySQL [PR CI 44820433868](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820433868) **3/3 SUCCESS**, [PR safety 44820433731](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820433731) **2/2 SUCCESS**. [PR #57](https://github.com/rehman2671/Aaditech-toolkit-new/pull/57) merged as `cc8e1f7bcea605c24a2865c7c2b00d5910aca38d`; fresh [main Windows pinned EXE/MSI 44820901522](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820901522) **4/4 SUCCESS** with extraction, install/clean uninstall and tenant-preserving major upgrade, [safety 44820901397](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820901397) **2/2 SUCCESS**, [project index 44820901328](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820901328) **SUCCESS**.
- [ ] Authentic approved publisher/HSM credentials, RSA N56 reviewer manifest, SQLite ZIP+EXE hash approvals, real protected signed source/release, package digest/SBOM owner review, customer Hostinger and physical Windows/MySQL evidence, offsite restore and security-owner approval **PENDING**. **Production NOT APPROVED.**

See [N62 acceptance](PHASE-N-STAGE62-ACCEPTANCE.md) and [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N61 — offline full remote-release bridge regression (MERGED; PR CI 3/3 + SAFETY 2/2, MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2 AND INDEX VERIFIED; PRODUCTION BLOCKED)

- [x] The **actual** `Assert-RemoteReleaseAssets.ps1` executes under Windows PowerShell 5.1 and 7 with an isolated synthetic in-process `gh api` shim that rejects unapproved endpoints, performs **no network requests** and uses N55 canonical disposable EXE/MSI checksums and actual source version.
- [x] An untagged draft and tagged published release pass the whole remote bridge with **only two exact read-only GitHub API calls**; malformed/missing/wrong public refs, other immutable release IDs, wrong uploaded MSI SHA256, simulated API error, malformed JSON, source SHA mismatch, missing GH_TOKEN and unapproved auto-push context are refused with redacted errors.
- [x] [PR CI 44799410572](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44799410572) Windows N31–N61, Node/Vitest+MySQL and API/MySQL **3/3 SUCCESS**, [PR safety 44799410550](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44799410550) **2/2 SUCCESS**; reviewed [PR #56](https://github.com/rehman2671/Aaditech-toolkit-new/pull/56) merged as `3da09f17966852770a8b8f7f9a03e31536685564`. Fresh [main Windows MSI 44799875413](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44799875413) **4/4 SUCCESS**, [main safety 44799875476](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44799875476) **2/2 SUCCESS**, and [project index 44799875343](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44799875343) **SUCCESS**.
- [ ] Real approved publisher/HSM certificate, independently scoped N56 short-lived RSA reviewer signature, SQLite ZIP/EXE pins, protected manual signed CI and real release draft/publication, customer Hostinger TLS/DNS, physical Windows lost-ACK/MySQL tenant evidence, offsite restore and security-owner signoff remain **PENDING**. **Production NOT APPROVED.**

See [N61 acceptance](PHASE-N-STAGE61-ACCEPTANCE.md) and [release issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N60 — draft ID and Git tag lifecycle repair (MERGED; PR CI 3/3 + SAFETY 2/2, MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2 AND INDEX SUCCESS; PRODUCTION BLOCKED)

- [x] Corrected the N59 first-live-release blocker: **unpublished drafts have pending tag names but no Git refs**, and REST `/releases/tags/<tag>` cannot retrieve draft records. The workflow now resolves the private draft's exact `gh release view --json databaseId,isDraft,tagName,targetCommitish` after `gh release create --draft`, then pins the validated numeric ID across all **three** remote asset attestations.
- [x] Draft/publication evidence fetched by exact `GET /releases/<numeric ID>`; draft requires **no exact Git ref** and published release requires exact Git lightweight tag pointing to human-approved signed-source SHA. A missing tag is valid only for the draft, and API failure, wrong/annotated/moved tag or different release ID fails closed.
- [x] Windows PowerShell 5.1/7 synthetic untagged-draft/public-SHA, annotated/moved/duplicate ref, immutable ID and N56 reviewer-gate ordering: [PR CI 44781529149](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44781529149) **3/3 SUCCESS**, [PR safety 44781528748](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44781528748) **2/2 SUCCESS**; [PR #55](https://github.com/rehman2671/Aaditech-toolkit-new/pull/55) merged as `be03575d8b0a42d562c5ffdefbdd511b8b02e067`. Fresh [main Windows EXE/MSI 44782117865](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44782117865) **4/4 SUCCESS**, [main safety 44782117884](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44782117884) **2/2 SUCCESS**, [index 44782117869](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44782117869) **SUCCESS**.
- [ ] Genuine publisher/HSM credentials, vetted SQLite hashes, independent RSA reviewer-signed approval, protected manual signing and signed draft/public release **not yet performed**; Hostinger customer DNS/TLS, physical Windows tenant/ACK evidence, MySQL replay and authorized security sign-off **PENDING**. **Production NOT APPROVED.**

See [N60 acceptance](PHASE-N-STAGE60-ACCEPTANCE.md) and [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N59 — unpublished draft + SHA256-verified GitHub Release assets (MERGED; PR CI 3/3 + SAFETY 2/2, MAIN MSI 4/4 + SAFETY 2/2 AND INDEX VERIFIED; PRODUCTION BLOCKED)

- [x] Protected publication code stages approved signed EXE/MSI/SHA256SUMS as a **non-public draft**. Serial release-tag publication with `cancel-in-progress: false`, reject pre-existing tags, no force-push or auto-delete of failed drafts. Live production path remains unexecuted.
- [x] Added staged draft-by-ID validation and **post-publication** lightweight Git tag-to-approved source SHA validation (corrected by N60), exactly three successfully uploaded asset names, sizes and **GitHub API `sha256:<digest>`** verified against freshly hashed signed local bytes and independent MSI pin; missing digest or changed data fail closed.
- [x] After draft upload, workflow rechecks exact original N56 reviewer signature and signed MSI/pinned SQLite, then repeats remote digest attestation **immediately before `gh release edit --draft=false`**, and checks published state and hosted digests afterward. Failed drafts remain unpublished for manual review; a post-publish failure requires security-owner incident handling.
- [x] Windows PowerShell 5.1/7 offline synthetic draft/hosted SHA and N31–N58 regressions [PR CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754414735) and [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754414651); [PR #54](https://github.com/rehman2671/Aaditech-toolkit-new/pull/54) merged as `ff86c5517150461a1fd55b5fc96072f387756286`. Fresh [main diagnostic MSI 4/4](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754917612), [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754917539) and [project index](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44754917638) verified. Repository immutable-release setting requires separate authorized owner review; CI cannot infer it.
- [ ] Genuine publisher/HSM credentials and reviewer-approved SQLite fingerprints, protected short-lived per-source reviewer RSA signature, manual signed CI and real draft-to-public verification, Hostinger DNS/TLS, customer Windows device queue/ACK MySQL evidence and human security sign-off **PENDING**. **Production NOT APPROVED.**

See [N59 acceptance](PHASE-N-STAGE59-ACCEPTANCE.md) and [security tracker #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N58 — same independently signed release approval across CI source and GitHub Release (MERGED; PR CI 3/3 + SAFETY 2/2, MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2 VERIFIED; PRODUCTION BLOCKED)

- [x] Protected manual N56 signing now reauthenticates the initial reviewer-approved manifest SHA256 receipt (64 uppercase hex + LF) **after** N55 final MSI/publisher inspection. CI upload requires `PUBLISH_SIGNED`, `PUBLICATION_VERIFIED` and `RELEASE_APPROVAL_RECEIPT_VERIFIED`. Automatic push/PR unsigned diagnostic artifacts correctly do not publish.
- [x] Separately dispatched protected GitHub Release now binds successful **manual main CI run source SHA**, SHA-pinned source checkout, exact version/revision tag, and N56 RSA reviewer signature to the **same original** receipt digest. Revalidates before staging the draft and again before the N59 public `gh release edit --draft=false` transition; even an alternative valid signed reviewer record fails.
- [x] Offline mandatory canonical EXE/MSI checksum + trusted publisher/timestamp and extracted signed MSI/approved SQLite/blank setup checks added. Public assets restricted to signed EXE, signed MSI and SHA256SUMS. The source approval receipt is CI-only and is not published as a release asset.
- [x] Windows PowerShell 5.1/7 synthetic scope/receipt/rotation/changed-source and N31 MSI-pin regression, Node/Vitest+MySQL, API/MySQL [PR CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748295565) and [PR safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748295510); [PR #53](https://github.com/rehman2671/Aaditech-toolkit-new/pull/53) merged at `c07a0560d573ca3095d91f7ccc363122049fd5e7`. Fresh [main diagnostic EXE/MSI lifecycle 4/4](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748922171), [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748922199), and [project index](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44748922258) independently passed. Actual manual reviewer-signed production publication remains PENDING.
- [ ] Independently vetted publisher/HSM signing material, real vetted SQLite ZIP/EXE bytes, reviewer private-key custody, actual manual protected signing+release publication, customer Hostinger DNS/TLS, physical Windows lost-ACK/tenant/MySQL receipts, offsite restore and security owner sign-off **PENDING**. **Production NOT APPROVED.**

See [N58 acceptance](PHASE-N-STAGE58-ACCEPTANCE.md) and [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N57 — race-safe main project index maintenance (MERGED; PR CI 3/3 + SAFETY 2/2, MAIN MSI 4/4 + SAFETY 2/2 AND INDEX PUBLISH SUCCESS; PRODUCTION BLOCKED)

- [x] `Publish-ProjectIndex.sh` now regenerates `project-index.json`, `project-state.json` and `project-progress.json` from the latest `main` source. On a genuine non-fast-forward advance, re-fetch/reset **ephemeral CI checkout** and regenerate rather than rebasing stale reports; no force-push, bounded four attempts, semantic `-Check` no-op and fail-closed denied-push behavior.
- [x] Serialized index jobs, main/CI-only plus bot-loop guards, full Git history and only three generated tracked reports. Isolated local Git concurrency/denied-push/no-op regression in [PR safety run 44743100705](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44743100705) **2/2 SUCCESS**; [PR app CI 44743100692](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44743100692) **3/3 SUCCESS**.
- [x] [PR #52](https://github.com/rehman2671/Aaditech-toolkit-new/pull/52) merged as `5d82d3ab7d34ae3c76f17d87813a50bef69e3273`. Fresh [main CI 44743528930](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44743528930) **Windows EXE/MSI install/uninstall/upgrade 4/4 SUCCESS** and [main safety 44743529039](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44743529039) **2/2 SUCCESS**. Actual [index maintenance 44743529081](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44743529081) **SUCCESS**, index-only bot commit `ed0245a9a180f25be229165e2df74ed0e25ac182` references the merged source, with production readiness still false. Historic [failed index race 44738371399](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44738371399) is a metadata push conflict, not customer production approval.
- [ ] Approved N56 independent reviewer identity, exact SQLite/publisher digests, protected actual signed MSI publication, customer Hostinger DNS/TLS, physical Windows/tenant replay and MySQL receipts, encrypted offsite restore and authorized external security sign-off still **PENDING**. **Production NOT APPROVED.**

See [N57 acceptance](PHASE-N-STAGE57-ACCEPTANCE.md) and [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N56 — reviewer-signed exact source/version/dependency release authorization (MERGED; PR CI 3/3 + SAFETY 2/2 GREEN; MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2 VERIFIED; PRODUCTION BLOCKED)

- [x] An approved publisher PFX and manual GitHub environment are **not** a release scope grant. Require separate RSA-SHA256 reviewer-signed ASCII/LF manifest pinning exact `main` Git SHA, `agent_version`, positive `msi_revision`, publisher thumbprint, independently approved SQLite ZIP/EXE hashes and short UTC window <=24h. Pin reviewer public DER SHA-256 independently. Never store reviewer private keys in CI/repo.
- [x] PrePackage verifies this record **before** loading PFX or invoking signtool; Finalize and N55 preupload verify the **same exact authenticated digest**. Missing, malformed, rotated or expired approval blocks publication with redacted errors. Reviewer secrets are manual protected-environment only.
- [x] Windows PowerShell 5.1/7 synthetic reviewer RSA, changed commit/version/revision/publisher/SQLite, approval rotation/expiry and signature-fault regression, N31–N55, Node/Vitest+MySQL and API/MySQL [PR CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44737871203); [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44737871073). [PR #51](https://github.com/rehman2671/Aaditech-toolkit-new/pull/51) merged at `d5142ccc5d8088cbeac13b0828fe1d9bb616c832`.
- [x] Independently verified fresh **main** diagnostic EXE/MSI build, administrative extraction, Windows setup/clean uninstall, major upgrade preserving tenant configuration and PowerShell/Node/API **4/4 SUCCESS** ([CI run 44738371422](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44738371422)), with [deployment safety 2/2 SUCCESS](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44738371382). Protected final signing verification and release artifact upload both **SKIPPED** on unsigned automatic push.
- [ ] Real separately signed reviewer scope, reviewed actual SQLite and publisher fingerprints, protected production signing and final signed MSI publication, Hostinger DNS/TLS, physical queue ACK-loss/MySQL receipts, offsite restore and human security sign-off **PENDING**. **Production NOT APPROVED.**

See [N56 acceptance](PHASE-N-STAGE56-ACCEPTANCE.md) and [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N55 — exact signed EXE/MSI revalidation immediately before release upload (MERGED; PR CI 3/3 + SAFETY 2/2 GREEN; MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2 VERIFIED; PRODUCTION BLOCKED)

- [x] Protected manual `main` publication now revalidates exact version, both EXE/MSI hashes and canonical two-line SHA256SUMS, one MSI, OS-trusted timestamp and pinned publisher cert, actual SQLite embedded in fresh final signed MSI extraction, and **blank external and embedded setup configs**. Upload requires both `PUBLISH_SIGNED=true` and `PUBLICATION_VERIFIED=true`.
- [x] Real Windows PowerShell 5.1/7 synthetic manifest tamper/reorder/duplicate/version tests and workflow upload order, prior N31–N54, Node/Vitest+MySQL and API/MySQL [PR CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733275703) and [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733275562). [PR #50](https://github.com/rehman2671/Aaditech-toolkit-new/pull/50) merged at `0d39f773162bb32f00b47898903ddb0b89b460e3`.
- [x] Independently verified fresh **main** diagnostic EXE/MSI build, MSI administrative extraction, installed setup/clean uninstall and major upgrade **4/4 SUCCESS** ([CI run 44733652919](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733652919)), with [deployment safety 2/2 SUCCESS](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44733653033). Signed final verification and upload correctly skipped on automatic push, and protected production signing remains **PENDING**.
- [ ] Actual protected manual signing/reviewer-controlled publisher custody, exact vetted SQLite ZIP/EXE fingerprints, customer Hostinger DNS/TLS, physical lost-ACK+MySQL receipts, offsite recovery and owner security sign-off remain **PENDING**. **Production NOT APPROVED.**

See [N55 acceptance](PHASE-N-STAGE55-ACCEPTANCE.md) and [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N54 — independent SQLite source and MSI payload SHA-256 pins (MERGED; PR CI 3/3 + SAFETY 2/2 GREEN; MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2 VERIFIED; PRODUCTION BLOCKED)

- [x] Release-signable MSI packaging now fails before network/extraction unless both the exact versioned official SQLite ZIP SHA-256 and extracted `sqlite3.exe` SHA-256 are independently approved through protected `production-installer` controls. ZIP before extraction, executable before/after staging and embedded MSI executable before signing. No self-derived approved hashes.
- [x] Windows PowerShell 5.1/7 local synthetic N54 checksum, mutation, size/UNC and ordering, N31–N53 safety, Node/Vitest+MySQL and API/MySQL [PR CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730289683); [deployment safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730289834). [PR #49](https://github.com/rehman2671/Aaditech-toolkit-new/pull/49) merged at `79915aec4afca14997a21f7b5c5f4143f8cc8ef2`.
- [x] Independently verified fresh **main** diagnostic EXE/MSI build, administrative extraction, real Windows setup/install/uninstall and major upgrade **4/4 SUCCESS** ([push CI run 44730648241](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730648241)); Bash/MySQL restore safety **2/2 SUCCESS** ([push run 44730648172](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44730648172)). Signed MSI upload **skipped**; production remains BLOCKED.
- [ ] Exact physically independently reviewed SQLite release fingerprints, customer Hostinger DNS/TLS, reviewer/HSM publisher custody, physical queue ACK-loss+MySQL receipts, encrypted offsite restore and owner security approval **PENDING**. **Production NOT APPROVED**.

See [N54 acceptance](PHASE-N-STAGE54-ACCEPTANCE.md) and [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N53 — bind complete live HTTPS diagnostic to its originally signed approval (MERGED; PR CI 3/3 + SAFETY 2/2 GREEN; MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2 VERIFIED; PRODUCTION BLOCKED)

- [x] N51 reviewer-signed canonical record verified at initial gate yields an in-memory SHA-256; N52 pre-DNS, pre-transfer and post-transfer gates must authenticate **the exact same** manifest bytes. New validly signed `approval_id` replacement is refused until a fresh operator-approved invocation. Redacted `BLOCKED` remains fail-closed.
- [x] PR Windows PowerShell 5.1+7 N53 original-record and valid RSA replacement regression, prior N31–N52, Node/Vitest+MySQL, API/MySQL and deployment safety green in [CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44728229481) and [safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44728229430). [PR #48](https://github.com/rehman2671/Aaditech-toolkit-new/pull/48) merged at `bcbd9860b9f138e9e72fc61a1d066d8645a80df3`.
- [x] Independently verified fresh **main** diagnostic EXE/MSI build, administrative extraction, real Windows setup/install/uninstall and major upgrade **4/4 SUCCESS** ([push CI run 44728607987](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44728607987)); Bash/MySQL restore safety **2/2 SUCCESS** ([push run 44728608211](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44728608211)). Signed MSI upload **skipped**; production remains BLOCKED.
- [ ] Real operator/reviewer key custody and customer Hostinger DNS/TLS, production Authenticode HSM MSI publication, physical device ACK-loss+MySQL receipts, encrypted offsite restore and final human security sign-off **PENDING**. **Production NOT APPROVED.**

See [N53 acceptance](PHASE-N-STAGE53-ACCEPTANCE.md) and [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N52 — signed curl approval revalidated across live DNS/HTTPS (MERGED; PR CI 3/3 + SAFETY 2/2 GREEN; MAIN DIAGNOSTIC MSI 4/4 + SAFETY 2/2 VERIFIED; PRODUCTION BLOCKED)

- [x] Reverify same independently pinned N51 RSA reviewer authorization **before DNS**, **immediately before native HTTPS transfer** and **after transfer before PASS**, in addition to the original pre-workspace gate. Invalid/expired/replaced signature fails redacted `BLOCKED`; no cached approval is sufficient.
- [x] Real Windows PowerShell 5.1 + 7 signed-approval recheck faults, prior N31–N51 suites, Node/Vitest+MySQL, API/MySQL and deployment safety all green in [PR #47](https://github.com/rehman2671/Aaditech-toolkit-new/pull/47): [CI 3/3](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44724914403), [deployment safety 2/2](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44724914312). Merged as `80ce1e7b5327cfc49806db5f38d982b920118b9b`.
- [x] Independently verified fresh **main** diagnostic EXE/MSI build, administrative extraction, real Windows setup/install/uninstall and major upgrade **4/4 SUCCESS** ([push CI run 44725323118](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44725323118)); Bash/MySQL restore safety **2/2 SUCCESS** ([push run 44725323133](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44725323133)). Signed MSI upload **skipped**; production remains BLOCKED.
- [ ] Independently approved public reviewer key/origin/curl signer and binary, live Hostinger DNS/TLS, HSM publisher-signed MSI, physical lost-ACK and tenant/MySQL replay evidence, offsite restore and security sign-off remain PENDING. **Production NOT APPROVED.**

See [N52 acceptance](PHASE-N-STAGE52-ACCEPTANCE.md) and [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N51 — signed, expiring independent reviewer curl approval (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Require signed reviewer approval of exact HTTPS origin, approved Microsoft curl signing-certificate DER SHA-256 **and** exact curl.exe file SHA-256, plus separately pinned reviewer public X.509 DER SHA-256. No locally generated key or signer cert automatically becomes approved.
- [x] Verify canonical raw ASCII-LF payload, distinct seven ordered fields, RSA-2048/4096 PKCS#1/SHA-256 signature, 24-hour maximum approval window, certificate validity, strict 64-hex pinned reviewer, bounded fixed-disk ordinary files without reparse/UNC. Fail `BLOCKED` before workspace/customer DNS/HTTPS, preserve existing consent and N31 automatic network BLOCKED.
- [x] Actual Windows PowerShell 5.1 + 7 offline throwaway reviewer RSA signing and canonical-manifest faults, N31–N50, Node/Vitest+MySQL, API/MySQL and deployment safety all passed. PR #46 merged as `2d6cc525b140a4e8768f931d9176861db9e2e44d`. [Main CI #44723214554](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44723214554) **4/4 SUCCESS** including EXE/MSI build, extraction, install/uninstall and tenant-preserving major upgrade; [main safety #44723214490](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44723214490) **2/2 SUCCESS**. Public signed MSI upload SKIPPED.
- [ ] Independently reviewed physical reviewer public key custody, approved customer Windows origin and exact signing/binary pins, Hostinger DNS/TLS/CA, signed production publisher MSI and HSM, physical lost-ACK queue evidence, encrypted offsite restore and security owner sign-off **PENDING**. **Production NOT APPROVED**.

See [N51 acceptance](PHASE-N-STAGE51-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N50 — independently approved exact Windows curl executable SHA-256 (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Require separately operator-approved `-ApprovedCurlBinarySha256` for **every** live Windows HTTPS health diagnostic, independent of `-ApprovedCurlSignerSha256` for the Microsoft signing certificate. Invalid, missing or unapproved executable digest fails before customer DNS; no silent local auto-pin.
- [x] Validate complete OS `curl.exe` file bytes via bounded streaming SHA-256, reject reparse/empty/oversized/missing files, and recheck executable digest following native version and HTTPS transfer; use only signed OS curl/Schannel from earlier stages. N31 automatic network probe remains BLOCKED.
- [x] Actual Windows PowerShell 7 and 5.1 offline executable-tamper, digest mismatch, malformed, oversize and real OS curl preflight; N31–N49, Node/Vitest+MySQL, API/MySQL and deployment safety all passed. PR #45 merged as `dd418f3f0677770db674c52a03d1b0cb01b923e9`. [Main CI #44717519494](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44717519494) **4/4 SUCCESS** including Windows EXE/MSI build, administrative extraction, clean install/uninstall and major upgrade; [main safety #44717519536](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44717519536) **2/2 SUCCESS**. Public signed artifact upload SKIPPED.
- [ ] Independent approval of BOTH exact signing-certificate DER SHA-256 and executable build SHA-256, customer Hostinger domain/TLS custody, publisher-signed release MSI, physical lost-ACK queue replay, encrypted offsite backup restore, integrations and human security review **PENDING**. **Production NOT APPROVED**.

See [N50 acceptance](PHASE-N-STAGE50-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N49 — independently approved Windows curl signer certificate SHA-256 (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Require per-live-invocation `-ApprovedCurlSignerSha256` in addition to exact approved origin and live operator confirmation; block missing, 40-character SHA-1, wrong, malformed or unapproved certificate pins **before customer DNS** without leaking certificate/fingerprint data. No pin or live option permitted for offline `-DryRun`.
- [x] Compare the approved 64-hex SHA-256 against the Authenticode signing certificate's DER bytes, never infer from local Windows host in live mode, and retain OS-owned signed curl/Schannel and pinned public-IP checks. This is a *signer certificate fingerprint*, not a curl EXE hash or HTTPS server certificate pin.
- [x] Windows PowerShell 5.1/7 synthetic mismatch and CI-only self-derived signer hash, prior N31–N48, Node/Vitest+MySQL, API/MySQL and deployment safety all passed. PR #44 merged as `bef167c5304b92a3cf964c597b60fa34f4d4b1a2`. [Main CI #44712168071](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44712168071) **4/4 SUCCESS** including Windows EXE/MSI build, administrative extraction, fresh install/uninstall and major upgrade; [main safety #44712168110](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44712168110) **2/2 SUCCESS**. Public publisher-signed MSI upload SKIPPED.
- [ ] Independent owner approval of Microsoft Windows curl signer certificate hash, physical customer Windows / Hostinger DNS+TLS, genuine publisher-signed public MSI/HSM, lost-ACK/MySQL evidence, encrypted offsite restore, integrations and release sign-off still **PENDING**. **Production NOT APPROVED**.

See [N49 acceptance](PHASE-N-STAGE49-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N48 — actual Windows system curl signer and Schannel provenance preflight (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Independently execute local `[Environment]::SystemDirectory\curl.exe` Authenticode signer validation and Schannel backend inspection in actual Windows PowerShell 7 and 5.1 CI. Reject reparse sources, invalid vendor signature, spoofed second-line `Schannel`, OpenSSL, native exit errors and unbounded output; never use PATH-provided curl.
- [x] Reuse the trusted OS binary for the separately operator-consented live `/healthz` check; clear CA/backend/proxy/keylogging process overrides before preflight, verify system binary **before customer DNS**, restore overrides on exit, keep N31 automatic live probe BLOCKED.
- [x] Windows PowerShell 5.1/7 real local signer/Schannel preflight, Node/Vitest+MySQL, API/MySQL and deployment safety passed; PR #43 merged as `a9f407b3082c01b3ece94ea62c307d639dfdd0fc`. [Main CI #44708591068](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44708591068) **4/4** including EXE/MSI build/extraction/install/uninstall/major upgrade; [main safety #44708591086](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44708591086) **2/2** passed. Public signed-artifact upload SKIPPED.
- [ ] Independent external Windows trust-store/certificate-chain audit, approved Hostinger DNS/TLS and physical operator-run acceptance, customer publisher-signed MSI/keys, lost-ACK replay, offsite restore, real integrations and human security review remain **PENDING**. No production release authorization.

See [N48 acceptance](PHASE-N-STAGE48-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29). **Production NOT APPROVED.**

## Stage N47 — fail-closed private Windows HTTPS response cleanup (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Fix N42–N46 silent `Remove-Item -ErrorAction SilentlyContinue` outcome: only report `PASS` after the exact private response file and workspace directory are **verified deleted**; cleanup failure forces redacted `BLOCKED/PRIVATE_WORKSPACE_CLEANUP` before report creation.
- [x] Session-owned private workspace cleanup refuses arbitrary directories, reparse targets and unexpected sibling files, never recursively deletes unknown content; locked files and partial-deletion retry fail closed and remain independently testable.
- [x] Windows PowerShell 7 and actual Windows PowerShell 5.1 offline file-lock/forged-workspace/unknown-child/partial-cleanup tests, Node/Vitest+MySQL, API/MySQL and deployment safety passed. PR #42 merged as `d70bc960d511288be81fee236663c6096f9da8c5`. [Main CI #44671007434](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44671007434) **4/4** including EXE/MSI build, extraction, install/uninstall and major upgrade; [main safety #44671007490](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44671007490) **2/2** passed. Signed public artifact upload SKIPPED.
- [ ] Independently approved physical Windows AV/cleanup and HTTPS fault drilling, real Hostinger DNS/TLS ownership, publisher-signed public MSI, physical queue lost-ACK replay, offsite restore and human security acceptance remain PENDING. **Production NOT APPROVED**.

See [N47 acceptance](PHASE-N-STAGE47-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N46 — atomic Windows workspace ACL at directory creation (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Eliminate N45 create-then-`Set-Acl` permission race: create unique private response directory with protected owner/SYSTEM ACL **at creation** using Windows PowerShell 5.1 `Directory.CreateDirectory(path, security)` and PowerShell 7 `FileSystemAclExtensions.CreateDirectory(security, path)`; no unsafe fallback.
- [x] Verify owner/protected allowed SIDs and preallocated exclusive response target; clean up only a directory demonstrably created by this invocation, never a preexisting/failed-create path. Live N31 probe stays DISABLED, report `certified_for_production=false`.
- [x] Actual Windows PowerShell 5.1 and 7 offline atomic-create, response ACL and code-contract regressions, Node/Vitest+MySQL, API/MySQL and deployment safety passed. PR #41 merged as `ee1b90cd6bbd3ae03d48dd1b10be565eb31f44e9`. [Main CI #44658368393](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44658368393) **4/4** including EXE/MSI build/extraction/install/uninstall/major upgrade; [main safety #44658368586](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44658368586) **2/2** passed. Signed public artifact upload SKIPPED.
- [ ] Independent physical Windows review, approved live Hostinger DNS/TLS/CA evidence, publisher-signed MSI/keys, physical lost-ACK queue replay, offsite restore, real integration and owner security approval remain PENDING. **Production NOT APPROVED**.

See [N46 acceptance](PHASE-N-STAGE46-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N45 — private Windows pinned HTTPS response workspace (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Native Windows LocalApplicationData workspace with unique per-run directory, explicit current-user and SYSTEM-only protected ACL, owner verification and no redirected/reparse ancestors; **no inherited TEMP/TMP permissions**.
- [x] Create fixed response file with exclusive `FileMode.CreateNew` before DNS/curl. Fail closed if private ACL/profile unavailable, do not enable N31 `-NetworkProbe`, and retain redacted `certified_for_production=false` evidence.
- [x] Windows PowerShell 7 and actual 5.1 no-network ACL/TEMP isolation, Node/Vitest+MySQL, API/MySQL and deployment safety passed; PR #40 merged as `43a1561dfc4b3c9d85dfa7b29f4e1b0b4afef7b2`. [Main CI #44652441152](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44652441152) **4/4** (EXE/MSI build, extraction, install/uninstall and major upgrade) and [main safety #44652441192](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44652441192) **2/2** passed. Public signed-artifact upload SKIPPED.
- [ ] Independent host ACL/profile-security review, customer-approved physical Windows HTTPS test, Hostinger DNS/TLS, real signed MSI publisher custody, lost-ACK queue replay and offsite restore still PENDING. **Production NOT APPROVED**.

See [N45 acceptance](PHASE-N-STAGE45-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N44 — offline Windows HTTPS diagnostic evidence format audit (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Audit an existing **redacted** N42/N43 diagnostic as an ordinary single-link file via `audit-windows-health-evidence.py` on a host supporting no-follow opens; reject duplicate JSON keys, invalid UTF-8, malformed schema, impossible status/mode pairs, self-asserted external approvals and false `certified_for_production=true`.
- [x] A syntactically valid `https_health_probe=PASS` must still return exit **3**, `production_approved=false` and the complete fixed list of required independent customer/security evidence; malformed input must exit **1** without creating a misleading audit file.
- [x] Offline N44 negative tests and 0600/exclusive publication passed. PR #39 merged as `004ad08ca02eef0e1503ba1a22f36a01668b2d18`. [Main CI #44649979210](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44649979210) **4/4** including genuine Windows MSI build/extraction/install/uninstall/major upgrade; [main safety #44649979330](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44649979330) **2/2** passed. Signed public artifact publication remains unapproved.
- [ ] This **format audit is NOT cryptographic attestation** of diagnostic freshness, origin, custody, physical execution or certificate provenance. Independently verify customer Hostinger DNS/TLS, physical Windows authenticated ACK, genuine publisher-signed MSI/operator key custody, offsite restore, integrations and human security sign-off. **Production NOT APPROVED.**

See [N44 acceptance](PHASE-N-STAGE44-ACCEPTANCE.md) and [independent customer security evidence issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N43 — origin-bound Windows pinned HTTPS consent and offline failure injection (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Operator-approved canonical `-ApprovedOrigin` required **alongside** exact live `-ConfirmLive PROBE_PUBLIC_HEALTH`; mismatch/invalid origin aborts *before* DNS, curl or network; N31 `-NetworkProbe` stays BLOCKED.
- [x] Shared offline outcome policy rejects DNS/connect/TLS/cert/timeout native exit errors, every nonexact HTTP 200 (including 3xx/4xx/5xx), missing/oversized/reparse response file and non-healthy N41 JSON; file length bounded before allocation/read.
- [x] Synthetic fault matrix and refused/host-mismatched operator consent on Windows PowerShell 7 and actual 5.1 CI; zero live customer requests and redacted non-production-certified evidence.
- [x] PR #38 PowerShell 7/5.1, Node/Vitest+MySQL, API/MySQL and deployment safety passed and merged as `d6a974d7c1fb24cd292051a98a3ba7824cf22069`. [Main CI #44647657565](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44647657565) **4/4** including EXE/MSI build, extraction, install/uninstall and major upgrade; [main safety #44647657434](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44647657434) **2/2** passed. Public signed MSI upload SKIPPED.
- [ ] Independent approved physical Windows DNS/TLS and failed-route rehearsal, real Hostinger public ownership, publisher signed MSI, physical queue ACK replay, offsite restore and human security review still **PENDING**. **Production NOT APPROVED**.

See [N43 acceptance](PHASE-N-STAGE43-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N42 — separately approved, pinned Windows public HTTPS diagnostic (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Optional `Test-WindowsPinnedPublicHttps.ps1` requires explicit `-ConfirmLive PROBE_PUBLIC_HEALTH` (N43 additionally binds live consent to exact canonical `-ApprovedOrigin`) and denies absent/invalid/mixed dry-run consent **before** config/DNS/HTTP; default N31 `-NetworkProbe` remains **BLOCKED**.
- [x] Strict N39/N40 all-returned-A/AAAA public address admission, connection-time IP pin via curl `--resolve`, `-q` first, `--noproxy '*'`, no redirects, HTTPS-only, hostname-verifying Schannel TLS, verified OS curl signature and cleared caller CA/backend/proxy overrides.
- [x] HTTP 200 plus bounded N41 JSON `status=ok`, `components.database=HEALTHY`; exclusive redacted and non-production-certified report; no credentials/tokens/tenant/device data in request or report.
- [x] Windows PowerShell 7/5.1 N42 offline tests, Node/Vitest+MySQL, isolated API/MySQL, PR deployment safety passed; PR #36 merged as `ac904c6b98edd622ccd217c14edfce3e49108e69`. [Main CI #44643192250](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44643192250) **4/4** (Windows EXE/MSI build/extraction/install/uninstall/major upgrade) and [main safety #44643192246](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44643192246) **2/2** passed. Signed public artifact upload was SKIPPED.
- [ ] Independent security review, actual approved Windows live probe, external public Hostinger DNS/TLS, publisher signed MSI, physical ACK/queue evidence, offsite restore and integrations **PENDING**. **Production NOT APPROVED**.

See [N42 acceptance](PHASE-N-STAGE42-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N41 — offline strict Windows public health JSON validation (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Pure PowerShell 5.1 offline `Assert-PublicWindowsHealthJson` verifies valid UTF-8 at most 65,536 bytes, JSON-depth/object-key bounds, decoded duplicate-key rejection at all depths and **exact** `status=ok`, `components.database=HEALTHY`.
- [x] N41 Windows CI synthetic regression accepts the real server health shape but rejects duplicate/escaped keys, nested spoofing, degraded state, wrong types, malformed UTF-8, BOM, oversized payload and nonfinite constants; no customer network invoked.
- [x] N41 PR PowerShell 7/**5.1**, Node/Vitest, isolated API/MySQL and deployment-safety passed; PR #35 merged. [Main CI #44637613809](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44637613809) **4/4** (Windows MSI build/extraction/install/uninstall/major upgrade included) and [main safety #44637613893](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44637613893) **2/2** passed.
- [ ] No N41 live probe activation, TLS trust assertion or `public_https=PASS`; Windows `-NetworkProbe` stays **BLOCKED** under N38. Independently approved Windows pinned HTTPS transport and external customer evidence are required.
- [ ] Real Hostinger DNS/TLS, publisher signature/key custody, offsite restore, physical Windows ACK and external integrations remain PENDING. **Production NOT APPROVED.**

See [Stage41 acceptance](PHASE-N-STAGE41-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).
## Stage N40 — offline Windows HTTPS endpoint admission (MERGED; MAIN CI/MSI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] N40 `Test-PublicWindowsEndpointOrigin` rejects noncanonical or unsafe agent setup URLs (private/metadata IPs, localhost, reserved domains, non-443 ports, userinfo, query/fragment, encoded or alternate paths), without DNS or HTTP.
- [x] N31 Windows preflight consumes the same N39/N40 policy and reports setup status as **offline name-shape only**, leaving `public_https=PENDING` or `BLOCKED` for the disabled `-NetworkProbe` and `certified_for_production=false`.
- [x] N40 policy/report-redaction, N31/N38/N39, Node/API/MySQL and safety PR CI passed; PR #34 merged. [Main CI #44633379380](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44633379380) **4/4** (Windows MSI diagnostic included) and [main safety #44633379367](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44633379367) **2/2** passed. Signed public MSI remains unverified.
- [ ] Live Windows TLS pinning, no-proxy/no-redirect transport, strict bounded health JSON, real customer proof, independently approved signing and Hostinger/restore/integration acceptance remain pending. **Production NOT APPROVED.**

See [Stage40 acceptance](PHASE-N-STAGE40-ACCEPTANCE.md) and [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N39 — offline Windows public A/AAAA address policy (MERGED; MAIN MSI CI 4/4 AND SAFETY 2/2 GREEN; PRODUCTION BLOCKED)

- [x] Public Windows PowerShell 5.1 module `PublicWindowsAddressPolicy.psm1` rejects private, metadata, documentation, multicast, mapped/tunnel IPv6, reserved hostnames and mixed public+private A/AAAA sets; deterministic public IP pin output (offline fixtures only).
- [x] Windows offline `Test-Stage39WindowsPublicAddressPolicy.ps1` passes without DNS/HTTP; redacted validation failures do not disclose hostile answer contents.
- [x] PR PowerShell/Node/API MySQL and deployment-safety passed; PR #32 merged and post-merge [main MSI CI #44575659496](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575659496) **4/4** plus [main safety #44575659160](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575659160) **2/2** passed. Real signed public MSI release not evidenced.
- [ ] Future native Windows live HTTPS probe remains **BLOCKED** until consent, public DNS resolution, **connection-time IP pinning**, TLS hostname trust, no proxy/redirect, strict JSON and real customer external checks are completed; [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29) remains OPEN.
- [ ] Independent human security review, signing/keys, physical Windows authenticated ACK, Hostinger external TLS, offsite restore and integrations not certified. **Production NOT APPROVED.**

See [Stage39 acceptance](PHASE-N-STAGE39-ACCEPTANCE.md).

## Stage N38 — Windows customer acceptance live-probe fail-closed mitigation (MERGED; MAIN CI/MSI 4/4 GREEN; PRODUCTION BLOCKED)

**Post-merge main verified 2026-11-19 IST:** Reconciled [N38 PR #31](https://github.com/rehman2671/Aaditech-toolkit-new/pull/31) merged as `d54325c9323a02152272ceb8f4c35be86fcf2767`. [Main CI #44517752267](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44517752267) **SUCCESS 4/4** (PowerShell N38 offline regression, Node/Vitest+MySQL, isolated API/MySQL, Windows EXE/MSI build/extraction/install/uninstall/major upgrade); [main safety #44517752316](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44517752316) **SUCCESS 2/2**. Publisher-signed release artifact upload **SKIPPED**. Owner-authorized merge is not independent human security certification.

**Historical N38 code evidence:** [Original #30](https://github.com/rehman2671/Aaditech-toolkit-new/pull/30) code head `5b596d347f5b7eebc491e95aa553d6866f2cf2f5` passed [full CI #44405914078](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44405914078) and [safety #44405914047](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44405914047). It conflicted after N37 merge. **Reconciled main-based [N38 PR #31](https://github.com/rehman2671/Aaditech-toolkit-new/pull/31)** carries forward exactly five intended N38 files, preserving latest main N37. New #31 CI and post-merge main MSI diagnostics must still be verified. This is *not* live Windows transport or independent human security acceptance.

- [x] Eliminate unpinned Windows `-NetworkProbe` health HTTP calls; when requested, report `public_https=BLOCKED` instead of attempting DNS/HTTP or reporting `PASS`. Default offline must stay `PENDING`.
- [x] Windows offline regression on a configured-looking synthetic HTTPS endpoint passes with **no** DNS/web/socket transport, no leaked host/token, and `certified_for_production=false`.
- [x] Existing N31/N32 Windows evidence non-overwrite tests continue to pass and new `Test-Stage38WindowsNetworkProbe.ps1` runs in CI.
- [x] N36 #27 and N37 #28 merged into main; conflicted N38 #30 reconciled on latest main into #31 without replacing N37 security changes.
- [x] Reconciled #31 [PR CI #44517374529](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44517374529) and [safety #44517374643](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44517374643) passed; owner-authorized merge completed.
- [x] N38 post-merge main EXE/MSI diagnostics, Windows install/uninstall and major upgrade tests **SUCCESS** in main CI #44517752267.
- [ ] Independent human security review remains an external requirement; cross-account maintainer merges do not establish it.
- [ ] **Issue #29 remains open:** the actual secure Windows native live HTTPS transport is **not** implemented or certified; pinned TLS, DNS/redirect/proxy/health negative tests and real customer approval still required.
- [ ] Hostinger ownership/TLS, physical Windows authenticated ACK replay, real signing-key custody/public MSI, offsite restore and integrations remain independently blocked. **Production: NOT APPROVED.**

See [Stage38 acceptance](PHASE-N-STAGE38-ACCEPTANCE.md) and [Windows probe tracking issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Stage N37 — public DNS pinning for optional authorized live acceptance (MERGED TO MAIN; MAIN DIAGNOSTIC CI PENDING; CUSTOMER PRODUCTION BLOCKED)

**GitHub merge 2026-11-19 IST:** [N37 PR #28](https://github.com/rehman2671/Aaditech-toolkit-new/pull/28) merged into main at `871f2e3900aae26f2abe4d9d9a93544700243c0f`, after PR CI and deployment safety passed. This was an **owner-authorized maintainer code merge**, not an independently certified human security review. Post-merge main Windows diagnostics and actual public Hostinger acceptance require their own evidence.

**Verified pre-retarget code:** N37 isolated-Python security head `ae807fbe5524ef1d96ecb0c78ece311d92fda05a` passed [CI #44389058206](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44389058206) and [safety #44389058159](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44389058159). N36 [PR #27](https://github.com/rehman2671/Aaditech-toolkit-new/pull/27) received a GitHub APPROVED review and **merged** into `main` as `517c8d0b25f645b76fb1a17367301b0443d397a3` (2026-11-18 UTC). N37 [PR #28](https://github.com/rehman2671/Aaditech-toolkit-new/pull/28) is now retargeted directly to `main`, remains **unmerged/review requested**, and must re-pass CI for the new HEAD/base context. Account-level approval alone is not evidence of an independent human security audit.

- [x] N37 offline Python tests reject RFC1918/loopback/link-local/metadata, special-use IPv4/IPv6 and mixed DNS answers (one private answer must block the entire hostname).
- [x] Mocked curl acceptance requires same validated public IP pinned for HTTPS/HTTP via `--resolve` and `--noproxy '*'`; DNS errors deny any HTTP, dry-run remains network-free.
- [x] Strict bounded `/healthz` JSON parser must reject duplicate/nested/oversized/malformed or degraded responses and accept only `status=ok` with `components.database=HEALTHY`; do not trust raw grep matches.
- [x] Direct Hostinger live CLI and Stage31 wrapper require explicit `--confirm-live PROBE_PUBLIC_HEALTH` before DNS/curl; missing/wrong consent and combined dry-run+live are denied without network access.
- [x] Live curl requests ignore user curlrc with first-argument `-q`; HTTP redirect check requires 301/302/303/307/308 and exact HTTPS-origin match (never accepts HTTP 200 with Location); no redirect is followed.
- [x] Both live curl subprocesses explicitly clear caller-provided `CURL_CA_BUNDLE`, `SSL_CERT_FILE`, `SSL_CERT_DIR` and `CURL_SSL_BACKEND`; offline mocked tests poison these environment variables and enforce fail-closed isolation. System CA trust **alone** does not establish independent publicly approved certificate issuer/custody.
- [x] Python DNS and health JSON helpers use `-I` isolated mode; poisoned `PYTHONPATH` test passed in [N37 safety #44389058159](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44389058159).
- [x] N37 PR deployment-safety plus PowerShell, Node/Vitest and isolated MySQL/API passed on last code commit `ae807fbe5524ef1d96ecb0c78ece311d92fda05a`. **New retargeted commit/context must pass separate CI before N37 acceptance.**
- [x] N36 GitHub approval/merge recorded, N37 retargeted from stacked N36 branch to `main`.
- [x] N37 retargeted-to-main head `128280d8c9e9290e13f55537c5b54e3990d5559d` passed [PR CI #44413295997](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44413295997) and [safety #44413296037](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44413296037); PR MSI build skipped.
- [ ] N37-specific human code review and authorized merge (and new docs-only HEAD CI), without mistaking cross-account approval alone for independent security certification.
- [ ] Main Windows MSI diagnostic build, install/upgrade acceptance and deployment safety must pass after authorized merges.
- [ ] Real Hostinger DNS ownership/actual TLS, offsite restore, physical Windows outage and replay, authority keys, public signed MSI and third-party services remain independently pending. Do not confuse synthetic pinned-route CI with actual live acceptance.
See [Stage37 acceptance](PHASE-N-STAGE37-ACCEPTANCE.md).

## Stage N36 — reconciled exclusive-report publication and reserved DNS policy (GITHUB APPROVED/MERGED; MAIN MSI AND CUSTOMER PRODUCTION PENDING)

- [x] Reconciled old PR #22's safe script/test fixes without overwriting accepted N32–N35 runbooks; stale/conflicting Stage32 document was excluded from merged N36.
- [x] Linux Stage31 atomic mode-600 report publication and race/symlink/host-policy tests passed on N36 PR CI.
- [x] Windows Stage31 `CreateNew` report non-overwrite regression passed on N36 PR CI.
- [x] [N36 PR CI #44304775570](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44304775570) and [PR safety #44304775551](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44304775551) **SUCCESS** for code head `7ea65635239d2013ca8fcea16d4392d33a9d62c3`. PR Windows MSI intentionally **SKIPPED**.
- [x] Formal GitHub APPROVED review and merge recorded: N36 `517c8d0b25f645b76fb1a17367301b0443d397a3` on 2026-11-18 UTC.
- [x] N36 post-merge [main CI #44412725232](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44412725232) **4/4 SUCCESS**: EXE/MSI build, administrative extraction, Windows install/uninstall and major-upgrade rehearsal passed; signed production artifact upload **SKIPPED**. [Main safety #44412725281](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44412725281) **2/2 SUCCESS**.
- [ ] Independent human security review provenance (if the two reviewer/account owners are the same operator), authorized publisher-signing custody and customer production gates remain separately pending.
- [ ] Hostinger DNS/TLS, real offsite restore, physical enrolled Windows replay, external authority key custody, public signed installer and live integrations remain independently blocked.
See [Stage36 acceptance](PHASE-N-STAGE36-ACCEPTANCE.md). This does not change any Stage N32–N35 accepted-code/blocked-production conclusions.

## Stage N35 — signed operator key enrollment, revocation, rotation and anti-rollback registry (CODE/CI ACCEPTED; CUSTOMER PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #26](https://github.com/rehman2671/Aaditech-toolkit-new/pull/26) merged as `c13818e84b7ad8bd28ae3c38fe10ddbee88eac0b`. [Main CI #44293404866](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44293404866) **4/4 SUCCESS**, [main safety #44293404832](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44293404832) **2/2 SUCCESS**. Real Windows PowerShell test used **CI-only ephemeral keys**. Publisher-signed public artifact upload **SKIPPED**.

- [x] Code/CI validates an Ed25519 root-authority signed registry with operator key IDs, DER SPKI SHA256, ACTIVE/REVOKED, purpose and validity. Only ephemeral test keys were generated; actual customer root approval is separately pending.
- [x] N35 verifier enforces separately supplied root SPKI SHA256, exact signed registry JSON SHA256 and exact revision; CI rejects missing/stale/altered/unsigned/expired/rolled-back inputs. Actual independent customer approvals are still pending.
- [x] CI confirms revoked operator rejection (including older signatures), higher-revision key rotation/successor acceptance and duplicate key ID/pin/purpose refusal. Real customer revocation/change control remains pending.
- [x] Windows CI verifies optional N35 registry-approval enforcement and records root pin/registry hash/revision while all external operator authorization, physical outage, production release and customer signoff statuses remain PENDING.
- [x] PR/main Node/Vitest, Windows PowerShell synthetic registry rotation/revocation, real isolated MySQL/API, genuine diagnostic Windows MSI and deployment-safety passed.
- [ ] Real root signing-key custody, external change approval/revocation distribution, production Hostinger DNS/TLS/restore, physical Windows replay, publicly signed MSI and live integrations remain separately required.

## Stage N34 — Ed25519 signed receipt evidence with independent public-key pin (CODE/CI ACCEPTED; CUSTOMER PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #25](https://github.com/rehman2671/Aaditech-toolkit-new/pull/25) merged at `974d3a0b66ce58446b0365d28f1f90c643245520`. [Main CI #44288994978](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44288994978) **4/4 SUCCESS**, [main safety #44288994965](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44288994965) **2/2 SUCCESS**. Windows/Node tested pinned Ed25519 with ephemeral test keys only. Signed public artifact upload **SKIPPED**.

- [x] Sign canonical digest-binding N32/N33 report payload with a separately authorized operator-controlled Ed25519 key, without generating/committing any real private key.
- [x] Independently approve the full SHA256 of the operator's DER SPKI public key. Signature verification must reject wrong trusted key, wrong pin, changed file bytes/event count, forged production claims, invalid/expired signatures and overwrites.
- [x] Windows evidence bundler optional signed mode must require server receipt + attestation + public key + approved pin, and keep source authorization, real network loss and production approval externally pending even when signature verifies.
- [x] PR/main Node/Vitest, PowerShell, real isolated MySQL/API, genuine diagnostic Windows MSI and safety CI must all pass before code acceptance.
- [ ] Real operator signing-key approval/rotation, physical customer network replay, real production MySQL, Hostinger/DNS/TLS, encrypted offsite restore, signed public MSI and live integrations remain independently required.

## Stage N33 — independently queried MySQL batch receipts and operator review (CODE/CI ACCEPTED; CUSTOMER PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #24](https://github.com/rehman2671/Aaditech-toolkit-new/pull/24) merged as `96d125a453264e6ea30e55df1f7b4d5e811fb6ca`. [Main CI #44282989949](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44282989949) **4/4 SUCCESS**, [safety #44282989853](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44282989853) **2/2 SUCCESS**. Real isolated MySQL confirms N33 scoped SELECT, tenant/device owner isolation, raw-count and tamper rejection. Public signed artifact upload was **SKIPPED**.

- [x] Independently verify immutable N32 Offline/Recovered evidence and private tenant/device/case binding with Stage33 read-only MySQL CLI, not the agent's token or the production app's admin DB credential.
- [x] One parameterized, tenant/device/batch-scoped SELECT must return exactly one receipt and identical event count, in a read-only transaction. Wrong owner, missing receipt, altered local hash, invalid event count and destination overwrite must fail closed.
- [x] Optional N32 evidence bundle -ServerReceiptReport must match SHA256 and counts. Source authentication and human review remain pending: unsigned JSON is not a certificate.
- [x] PR Node/Vitest, PowerShell, disposable real MySQL/API and deployment safety, plus main Windows diagnostic MSI 4/4 and safety 2/2, must pass before code/CI acceptance.
- [ ] Separate customer physical network outage, NETWORK SERVICE reconnect, independently authenticated MySQL operator evidence, approved signed MSI, Hostinger VPS/DNS/TLS, offsite restore and live integrations remain OPEN.

## Stage N32 — physical agent local ACK evidence and redacted SHA256 provenance (CODE/CI ACCEPTED; CUSTOMER PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #23](https://github.com/rehman2671/Aaditech-toolkit-new/pull/23) merged at `022cdf78c2c69946b860a9cfaeb97f3e53f29318`. [Main CI #44277910476](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44277910476) **SUCCESS 4/4**; [main safety #44277910495](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44277910495) **SUCCESS 2/2**. Windows job log explicitly confirms **N32 PASS** for real SQLite offline/recovered SHA256 evidence and bundle across a genuine diagnostic MSI upgrade, using **synthetic local ACK only**. Public signed artifact upload **SKIPPED**.

- [x] Windows operator collector requires explicit offline/reconnect attestations. It only reads installed SQLite; it never disconnects network, triggers the agent, reads credentials, mutates outbox rows, or reports actual server ACK without independent evidence.
- [x] CI test proves consent missing, missing queue, report overwrite and tampered payload/queue evidence are rejected.
- [x] Real diagnostic Windows MSI test exercises N32 Offline snapshot before major upgrade, queue survival, synthetic local-ACK state, Recovered snapshot and redacted SHA256 manifest against actual bundled sqlite3.exe.
- [x] After PR/main checks are green, synchronize acceptance and release ledgers with genuine workflow links; do NOT equate simulated local-ACK CI with a real network failure.
- [ ] Operator-authorized physical enrolled customer Windows and real DNS/TLS must show offline interruption followed by eventual local ACK; independent authorized MySQL receipt query must confirm scoped batch receipt and event count.
- [ ] Real production offsite MySQL restore/migration, public publisher-signed MSI and external SMTP/webhook/Graph/ITSM integrations remain separate approval gates.

## Stage N31 — read-only deployment/Windows preflight and independent public release pins (CODE/CI ACCEPTED; CUSTOMER PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #21](https://github.com/rehman2671/Aaditech-toolkit-new/pull/21) merged at `6874e72f2faf9499b4d584b8852781a111b092da`. [Main CI #44193878515](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44193878515) **4/4 SUCCESS**; [main safety #44193879125](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44193879125) **2/2 SUCCESS**. Public signing and signed-artifact upload **SKIPPED**.

- [x] N31 synthetic/offline CI verifies `preflight-stage31.sh --env-file PRIVATE_ENV --report-file NEW_JSON`, safe permissions and redacted report. **Actual production env not yet supplied or tested.**
- [ ] Real Hostinger public TLS/redirect/MySQL check only after operator explicitly passes `--live --confirm-live PROBE_PUBLIC_HEALTH`. No host/domain is assumed before deployment.
- [x] Windows CI negative fixture verifies `Test-CustomerWindowsAcceptance.ps1` blocks unconfigured machine, redacts secrets and avoids live GET by default.
- [ ] Run that same collector on a real customer Windows device and separately verify actual HTTPS, enrollment, NETWORK SERVICE and SQLite queue.
- [x] Publication workflow requires manual `approved_source_sha`, independent `approved_msi_sha256`, approved publisher pin, trusted timestamp, signed embedded EXE and new tag. Negative CI fixtures reject malformed/mismatched inputs.
- [ ] Actual approved public Authenticode EXE/MSI signing, publisher/CA verification and GitHub Release publication require separate human approval.
- [x] CI regression proves offline tests, unsigned/mismatched publisher checksum rejection and unconfigured Windows reports BLOCKED without network activity.
- [ ] On actual Hostinger VPS: approve private env, DNS/TLS ownership, encryption, production migration and offsite MySQL restore. **NOT YET VERIFIED.**
- [ ] On real customer Windows: verify offline ACK-loss/retry under NETWORK SERVICE and trusted publisher MSI installation. **NOT YET VERIFIED.**
- [ ] Protected manual release approval, public Authenticode-signed MSI publication and live SMTP/webhook/Graph/ITSM integrations. **NOT YET VERIFIED.**

## Stage N30 — real MSI pending SQLite queue + safe receipt cleanup (CODE/CI ACCEPTED; CUSTOMER PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #20](https://github.com/rehman2671/Aaditech-toolkit-new/pull/20) merged at `3aa28aee3061f5b70ee81dca9b6460f67837e6ac`. [Main CI #44190267130](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44190267130) **4/4 SUCCESS**, including actual SQLite in-flight queue + exact JSON preservation across real Windows major upgrade 1.1.2001 -> 1.1.2002; [main safety #44190267337](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44190267337) **2/2 SUCCESS**. Signed public MSI upload skipped.

- [x] On main CI, real Windows diagnostic MSI major upgrade verifies installed sqlite3.exe, ProgramData queue.sqlite3 integrity, persistent queue UUID, two pending rows and exact original pending JSON before/after upgrade.
- [x] Isolated MySQL verifies migration 015, 400-day active receipt still dedupes, dry-run default, 180-day minimum, bounded deletion and absent-tenant/zero-device owner guards.
- [x] Confirm main Node/Vitest, PowerShell, API/MySQL, Windows MSI and safety results before code/CI acceptance.
- [ ] Production customer backup/offsite restore, real Windows NETWORK SERVICE and offline ACK-loss, Hostinger VPS/DNS/TLS, public signed MSI, real SMTP/webhook, Graph/ITSM integrations remain separately pending.

## Stage N29 — atomic keyed telemetry request replay (CODE/CI ACCEPTED; PRODUCTION BLOCKED)

**Evidence (2026-11-18 IST):** [PR #19](https://github.com/rehman2671/Aaditech-toolkit-new/pull/19) merged as `5de1def715f02b7494c7c0dc1c7585cf6d1aee94`. [Main CI #44186527404](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44186527404) **4/4 SUCCESS**, including genuine Windows diagnostic MSI install/uninstall/upgrade; [main safety #44186527011](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44186527011) **2/2 SUCCESS**. Public signed artifact upload skipped.

- [x] PR/main CI verifies migration 014, 16-way direct transactional races, 8-way HTTP replay, atomic DB rollback and 409 key-content conflicts.
- [x] Mocked PowerShell canonical Windows worker tests verify byte-identical SQLite JSON replay on lost/partial ACK; matching batch ID/count required.
- [x] Real Windows diagnostic MSI installation/uninstall and major-upgrade preserved server/tenant configuration and enrolled credentials on main.
- [ ] Separate physical pending `queue.sqlite3` file and in-flight `telemetry_outbox` preservation across MSI major upgrade (NOT covered by the existing CI upgrade fixture).
- [ ] Operator-authorized encrypted production MySQL backup/offsite restore and migration 014 rehearsal on actual Hostinger target.
- [ ] Physical Windows enrollment/NETWORK SERVICE/offline retry, public signed Authenticode MSI and real DNS/TLS/SMTP/Graph/ITSM acceptance. **NOT YET VERIFIED.**
- [ ] Keyed batch DB writes are atomic only inside local InnoDB. Actual delivered SMTP/webhook requests are **at-least-once**, not exactly-once.

## Stage N28 — authenticated event retry dedup (CODE/CI ACCEPTED; PRODUCTION BLOCKED)

**Verified 2026-11-18 IST:** [PR #18](https://github.com/rehman2671/Aaditech-toolkit-new/pull/18) merged at `061694329e98e789af362545e9afe5806508fb6c`; [main CI #44181875110](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44181875110) **4/4 SUCCESS** including authentic Windows diagnostic MSI build/install/upgrade; [main safety #44181875324](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44181875324) **2/2 SUCCESS**. This is **not** a signed public release.

- [x] Verify PR Node/Vitest, PowerShell ACK+queue identity tests, real MySQL 24-way dedup concurrency, Windows diagnostic MSI on main and deployment safety.
- [ ] Supervised migration 013 after authorized encrypted offsite MySQL backup and restore.
- [ ] Customer-enrolled physical Windows ACK-loss replay, reinstall fresh queue and upgrade preserving original identity.
- [ ] Public signing, Hostinger/DNS/TLS, live SMTP/webhooks and third-party connections separately blocked. No full HTTP/alert exactly-once claim.

## Stage N27 — idle-device metrics cadence and outbox ACK safety (CODE/CI ACCEPTED; PRODUCTION BLOCKED)

**Automated accepted (2026-11-18 IST):** [PR #17](https://github.com/rehman2671/Aaditech-toolkit-new/pull/17), [main CI #44173643947](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44173643947) **4/4 SUCCESS** including genuine Windows diagnostic MSI install/uninstall/upgrade, [main safety #44173643755](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44173643755) **2/2 SUCCESS**. Signed artifact upload was **SKIPPED**.

- [x] Verify PR Node/Vitest, behavioral PowerShell agent tests, real MySQL/API and safety CI; merge and verify genuine diagnostic Windows EXE/MSI pipeline on main.
- [ ] With a properly enrolled physical Windows MSI agent, monitor a device with no queued collector events for at least 30 minutes: measured CPU/RAM/disk must refresh at about five-minute intervals without rerunning full inventory or privileged collectors.
- [ ] Deny outbound HTTPS, return malformed/partial ACK responses in a controlled environment and verify pending SQLite events remain retryable. Verify successful server ACK marks exactly the local rows delivered; retries are at-least-once (not deduplicated exactly-once).
- [ ] Recheck the 15-minute tenant telemetry freshness policy, legitimate zero values and real notification behavior. No acceptance without genuine customer devices and independent evidence.
- [ ] All public signer, Hostinger VPS/DNS/TLS, offsite customer MySQL recovery, live SMTP/webhook and independent Graph/Jira acceptance gates remain **BLOCKED**.

## Stage N26 — canonical MSI-agent telemetry (CODE/CI ACCEPTED; PRODUCTION BLOCKED)

**Automated accepted (2026-11-17):** [PR #16](https://github.com/rehman2671/Aaditech-toolkit-new/pull/16);
[main CI #44148317301](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44148317301) **SUCCESS 4/4** including diagnostic Windows MSI and [main deployment-safety #44148317186](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44148317186) **SUCCESS 2/2**. Public artifact signing/upload deliberately skipped.

- [x] Verify CI (Node/Vitest, PowerShell, real MySQL and diagnostic Windows MSI) on PR and merged main.
- [ ] On an authorized physical Windows MSI install, confirm canonical Agent-Collect.exe reports fresh CPU, RAM, system-drive free disk, BitLocker, Defender and firewall state to the enrolled workspace.
- [ ] Under a collector-denied account, prove unavailable values remain NULL or UNKNOWN, and replayed outbox events are not promoted to current measurements.
- [ ] Verify genuine 0 GB free disk can alert but missing/null measurements never trigger low-disk notifications.
- [ ] Secure Boot, local-admin membership and cloud compliance remain unverified. Production Hostinger, public MSI signing, offsite restore, actual inbox/webhook and customer UAC gates remain BLOCKED.


## Stage N25 measured device telemetry and real-inventory acceptance

**Automated CODE/CI accepted (2026-11-17):** [PR #15](https://github.com/rehman2671/Aaditech-toolkit-new/pull/15), [main CI #44068596639](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44068596639) **4/4 SUCCESS** including diagnostic Windows MSI, [main safety #44068596502](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44068596502) **2/2 SUCCESS**. Customer/production evidence checkboxes remain unchecked.

- [ ] Back up the authorized production MySQL database and rehearse full offsite recovery before applying `012_measured_device_telemetry.sql`. Historic default usage must stay unverified until genuine enrolled-device reports.
- [ ] On customer-managed Windows, verify a never-connected registration shows no CPU/RAM/disk/battery values, and a collector failure reports NULL, not fabricated success. Validate real measured 0%, partial and stale snapshots.
- [ ] Verify processes and app-usage display `NOT_REPORTED` without current agent evidence; validate real MySQL process INSERT `updated_at` and that an unplugged/offline device's cached activity expires within 15 minutes.
- [ ] Verify prediction requires measured samples over at least one hour and that a NULL disk forecast never presents a cleanup action; require operator approval for any actual remote remediation.
- [ ] Rehearse diagnostic Windows EXE/MSI upgrade on physical devices, then obtain separate authorized public Authenticode signer approval and Hostinger customer production sign-off.


## Stage N24 genuine posture collection and customer evidence

**Automated code/CI accepted (2026-11-17):** [PR #14](https://github.com/rehman2671/Aaditech-toolkit-new/pull/14), [main CI #44065258102](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258102) **4/4 SUCCESS** including diagnostic Windows MSI, [main safety #44065258073](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44065258073) **2/2 SUCCESS**. Live production acceptance remains BLOCKED pending operator evidence.

- [ ] Obtain authorized production DB backup and independently verified offsite restore before applying `011_security_posture_provenance.sql`; confirm historical `posture_reported_at` remains NULL rather than inferring health from old defaults.
- [ ] Upgrade actual managed Windows agents with the corrected collector; verify BitLocker/Defender/firewall explicitly report UNKNOWN on collector failure and healthy only when observed, without physical test data in Git logs.
- [ ] Recheck security posture and cloud audit with fresh measured/unknown/stale states for multiple enrolled customer devices; ensure `secure_boot` and `local_admins_count` remain unverified until genuine collectors/attestation are implemented.
- [ ] Obtain independent customer/MDM approval for any external compliance claim. Device-reported status does not prove Microsoft Graph/Intune connection or third-party attestation.


## Stage N23 command control and external acceptance

**Automated code/CI acceptance confirmed (2026-11-17):** [PR #13](https://github.com/rehman2671/Aaditech-toolkit-new/pull/13), [main CI #44054232799](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232799) **4/4 PASS** including diagnostic Windows MSI rehearsal; [main safety #44054232802](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44054232802) **2/2 PASS**. Operator/production checkboxes below remain deliberately unchecked pending customer evidence.

- [ ] Confirm only credential-verified enrolled devices can claim commands via atomic conditional MySQL updates; no parallel API process can distribute the same PENDING command twice.
- [ ] Confirm write outages return HTTP 503 (not fabricated queued success); command completion and duplicate result status are SQL-acknowledged and recorded once.
- [ ] Treat lost agent result for an IN_PROGRESS reboot/script as **unknown execution outcome** requiring human investigation. Never auto-requeue destructive commands without verified device-side exactly-once controls.
- [ ] Repeat the acceptance on a real enrolled device under customer-approved policies; GitHub workflow signatures and ephemeral MySQL evidence do not substitute for signed production release.


**Status: BLOCKED until independent operator evidence is entered.** Automated main CI is diagnostic; it does not authorize customer deployment or public release.

This runbook applies to the repository's Node.js/Express + MySQL 8 service and Windows agent. Never apply the old PostgreSQL/FastAPI deployment scripts. Never share private credentials in GitHub comments or chat.

## A. Production infrastructure and identity

**Responsible:** Hostinger VPS owner + security/change approver.

- [ ] Confirm a Docker-capable VPS (not ordinary Hostinger shared hosting), ownership, IP, correct actual public DNS A/AAAA record, firewall 80/443 and Caddy trusted TLS. Do not deploy to a placeholder host.
- [ ] Ensure restricted private `Enterprise/.env` exists on the VPS (mode 600), includes cryptographically random unique required secrets, authorized `PLATFORM_ADMIN_USER_ID` and `PLATFORM_OWNER_TENANT_ID`, and is absent from the repository.
- [ ] Before changing running services, run the **read-only** `bash Enterprise/deploy/preflight-stage14.sh --release` against the private environment; do not interpret `--dry-run` as a live success.
- [ ] Run on the authorized VPS: `cd Enterprise/deploy && bash deploy-mysql.sh --host actual.yourdomain.com --dry-run`. After change approval, the VPS operator may run the actual `bash deploy-mysql.sh --host actual.yourdomain.com` and record the deployment SHA, host and incident rollback contact. Existing secrets/database volumes must be preserved.
- [ ] From an independent public network run `bash Enterprise/deploy/verify-hostinger-acceptance.sh --host actual.yourdomain.com`. Confirm HTTPS certificate chain, HTTP redirect, `/healthz` and MySQL HEALTHY. Capture the unredacted HTTP status and a *redacted* certificate/host proof (no credentials).

**Evidence:** host/domain and DNS proof: ______________ · TLS and live health: ______________ · approver/date: ______________

## B. Database restore rehearsal and tenant identity safety

**Responsible:** Database operator. **STOP** on collision, unowned tenant identity or unrecoverable backup.

- [ ] Take an approved, encrypted backup using repository procedure `Enterprise/deploy/backup.sh` plus a separate authorized offsite copy; document backup integrity, timestamp, retention and recovery point.
- [ ] Restore using `Enterprise/deploy/restore.sh` into a **separate disposable production-like environment**, never destructively into the live DB merely to test. Verify tenant/member/device identity uniqueness and no accidental reassignment of historical NULL-owned remediation logs.
- [ ] Confirm migrations `005_remediation_tenant_logs.sql` and `006_notification_outbox.sql` applied once, have expected indexes, and do not expose data across workspaces. Confirm application upgrade and rollback/recovery with the exact backed-up state.
- [ ] Confirm `007_scrub_legacy_github_pat.sql` and `008_scrub_legacy_ticket_keys.sql` applied exactly once; verify no old `branding.github_token` or `ticketConfig.api_key` remains. Capture only **redacted** evidence; never dump secrets into CI logs.
- [ ] Confirm migration `009_notification_destination_binding.sql` adds the outbox destination HMAC. Historic jobs without trustworthy hashes must stay NULL and SKIPPED, not redirected after recipient changes. Plan private HMAC_SECRET rotation deliberately.
- [ ] Confirm migration `010_events_tenant_device_identity.sql` adds nullable tenant/device ownership and index; verify historic event rows remain NULL-owned (no hostname-based reattribution) and tenant APIs read only explicitly owned events.
- [ ] Verify tenant-level ticket metadata and cloud-audit views never imply a real Jira/Graph connector without real provider responses and separate authorization.
- [ ] Perform negative tests: MySQL failure returns fail-closed API, tenant cannot request another tenant's audit logs, processes, patch approvals, remediation or notification status.
- [ ] Record measured restore and recovery times (RTO/RPO); CI disposable MySQL proofs are not substitutes.

**Evidence:** encrypted backup checksum: ______________ · restored-instance ID and validated snapshot: ______________ · RTO/RPO: ______________ · approver: ______________

## C. SMTP and outbound webhook delivery

**Responsible:** Platform operator + authorized tenant SUPER_ADMIN.

- [ ] Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_ALLOWED_RECIPIENT_DOMAINS` privately on the VPS. TLS/STARTTLS with valid certificate is mandatory; credentials must never enter the browser or public repository.
- [ ] Each tenant SUPER_ADMIN separately opts into email/webhook and an approved address or exact HTTPS host; confirm no legacy global destination inherited.
- [ ] Use Alerts test-email to verify SMTP relay DATA 250, **and independently verify actual message in approved recipient inbox with correct headers**; check bounce and suppression. Relay 250 alone is not inbox delivery.
- [ ] Confirm webhook host is in `WEBHOOK_ALLOWED_HOSTS`, TLS and SNI correct, no private-IP DNS redirection, and only the correct workspace's non-sensitive test alert arrives.
- [ ] Review `GET /api/v1/alerts/notifications/status` as tenant SUPER_ADMIN: PENDING/PROCESSING retry behavior, DEAD alerts, and real operations monitoring. Endpoint returns aggregate counts only.
- [ ] Verify retry receiver deduplication expectations. The outbox provides **at-least-once delivery**, not exactly-once or guaranteed inbox placement.

**Evidence:** redacted SMTP certificate and relay test: ______________ · real inbox receipt: ______________ · webhook receiver proof: ______________ · approver: ______________

## D. Publisher-signed MSI and managed Windows hardware

**Responsible:** Release signing officer + Windows endpoint owner.

- [ ] Obtain an authorized public code-signing identity and certificate thumbprint; verify publisher trust and timestamp policy. Signing secrets/keys never enter repository or chat.
- [ ] Manually dispatch a trusted **main-branch CI** run configured for actual signing; require verified signed EXE/MSI artifacts, matching source SHA and release version.
- [ ] After independent publisher/thumbprint verification and release approval, manually use `.github/workflows/publish-signed-installer.yml` with verified source run, exact tag and confirmation, through protected `production-installer` environment. An ordinary push CI diagnostic MSI is **not** a signed release.
- [ ] On physical managed Windows machines, validate UAC, fresh install, enrollment, HTTPS server configuration editing after install, proxy/TLS behavior, uninstall and major upgrade while preserving authorized tenant identity. Repeat with wrong server/unapproved tenant and ensure safe failure.
- [ ] Confirm release hash/installer provenance before permitting customer downloads; record SHA256, Authenticode signer, timestamp and proof of rollback.

**Evidence:** signed source run/tag: ______________ · trusted publisher/thumbprint: ______________ · hardware/UAC/in-place upgrade result: ______________ · approver: ______________

## E. Release decision

| Gate | Current verified status | Human acceptance evidence |
|---|---|---|
| Stage 17 code + diagnostic CI | Accepted: main CI #43981328283 4/4; safety #43981328387 2/2 | GitHub Actions |
| Stage 18 tenant boundaries | **Accepted diagnostic CI:** main #43982225279 SUCCESS 4/4; safety #43982225214 SUCCESS 2/2 | GitHub Actions |
| Stage 19 operator-only release controls | **Accepted diagnostic CI:** main #43988981985 SUCCESS 4/4; safety #43988982034 SUCCESS 2/2 | GitHub Actions |
| Stage 20 truthful ticket/cloud integrations | **Accepted diagnostic CI:** main #43989734105 SUCCESS 4/4; safety #43989734122 SUCCESS 2/2 | GitHub Actions |
| Stage 21 notification destination binding | **Accepted diagnostic CI:** main #44042340512 SUCCESS 4/4; safety #44042340598 SUCCESS 2/2 | GitHub Actions |
| Stage 22 tenant event identity | **Accepted diagnostic CI:** main #44043497516 SUCCESS 4/4; safety #44043497509 SUCCESS 2/2 | GitHub Actions |
| Real Hostinger VPS/DNS/TLS | **BLOCKED** | __________ |
| Authorized production migration / offsite restore | **BLOCKED** | __________ |
| Real SMTP inbox + webhook receiver | **BLOCKED** | __________ |
| Real Jira/ServiceNow/Zendesk API + Microsoft Graph OAuth acceptance | **NOT CONNECTED — CODE/PROVIDER GATE OPEN** | __________ |
| Human-approved signed MSI publication | **BLOCKED** | __________ |
| Physical Windows managed UAC/install/upgrade | **BLOCKED** | __________ |

**Decision rule:** Never label this application *production certified*, publish a signed public MSI, or report live deployment successful until every external gate is independently accepted by an authorized owner. No password, setup token, private key or customer data belongs in this checklist.
