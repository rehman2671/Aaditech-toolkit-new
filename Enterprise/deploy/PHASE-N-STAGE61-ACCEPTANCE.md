# Phase N Stage 61 — Offline integration coverage for the protected remote release verifier

**Status: CODE PROPOSED; PR CI / POST-MERGE MAIN ACCEPTANCE PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-21 IST).**

## Gap and acceptance objective

N59 verifies the exact three GitHub-hosted installer asset digests, and N60
repairs the real GitHub draft/tag lifecycle with a numeric immutable release
ID. Prior acceptance verified helper modules with synthetic JSON and used
static workflow-ordering checks, but did **not invoke the actual protected
`Assert-RemoteReleaseAssets.ps1` bridge** end-to-end. This leaves a
deployment-readiness blind spot: native PowerShell command invocation,
stubbed API errors, protected-context guards and the bridging of both
GitHub API responses into the N59 and N60 modules were not exercised
together in real Windows 5.1 and 7.

Stage N61 closes this testing gap **without creating a private draft or
publishing a real installer**. No production signing keys, Github token,
live Hostinger, Windows customer device or customer MySQL database are
required.

## Implementation and fixtures

`Enterprise/tests/Test-Stage61RemoteReleaseBridge.ps1` invokes the
**same full protected production script**
`Enterprise/agent/build/Assert-RemoteReleaseAssets.ps1` used at the
N60 draft and publication boundaries. It creates minimal synthetic
unsigned EXE and MSI files and N55 canonical SHA256SUMS under a
disposable Windows-local temp directory. Version and MSI revision are
read from the actual checked-out `agent-version.json` so a later
version change cannot silently invalidate the fixture.

Within the test process an in-memory **`gh api` PowerShell shim** returns
synthetic GitHub JSON for only the precise expected endpoints:

- `repos/<synthetic-owner>/<synthetic-repo>/git/matching-refs/tags/<versioned-tag>`
- `repos/<synthetic-owner>/<synthetic-repo>/releases/<immutable-numeric-id>`

Any unexpected command or endpoint is refused, **without network
access**. The injected `GH_TOKEN` is a dummy offline marker,
never a GitHub credential. The fake API includes three SHA256-verified
assets with canonical names, `state=uploaded`, positive asset IDs,
exact local byte lengths and individually recomputed SHA256 hashes.

The bridge must pass a private draft **without** an existing Git tag,
and a published release **with** an exact lightweight
`refs/tags/<versioned-tag>` pointing to the approved signing SHA.
Both success paths must make exactly **two read-only API calls**,
in the expected order. The test then injects rejected states:

- Published state claimed without any real Git tag; draft requested
  while a public Git tag already exists; moved tag to wrong source.
- Different release ID in actual GitHub API JSON even with correct
  tag and asset content; mutated hosted MSI digest.
- Simulated API error (nonzero native command status), malformed
  JSON response, mismatched source SHA, missing GH_TOKEN.
- Automatic push context instead of protected manual dispatch:
  rejection **before any GitHub call**.
- Failure messages are deliberately redacted to the stable
  `N60 remote release publication integrity blocked.` result.

This tests the live bridge's actual module composition, no longer
only static source markers or individual function behavior.

`.github/workflows/ci.yml` runs the test on Windows with
**PowerShell 7 and built-in Windows PowerShell 5.1**, alongside all
N31–N60 publisher safety regressions, Node/Vitest+MySQL and API/MySQL.
Both CI runners use the exact same synthetic test, no signing secret,
external release or user action.

## Acceptance checklist

- [ ] Windows PowerShell 5.1 and 7 N61 bridge tests passed, N31–N60
  suites and PR application CI **3/3**; deployment safety **2/2**.
- [ ] Reviewed PR merged; fresh `main` PowerShell, Node/MySQL and
  API/MySQL, plus **real diagnostic Windows MSI** build, administrative
  extraction, real install/clean uninstall and tenant-preserving major
  upgrade **4/4**; deployment safety **2/2**; project index refreshed.
- [ ] Exact independently reviewed N56 RSA reviewer manifest,
  publisher certificate/HSM custody and SQLite hashes; protected
  `CI` signed source run, real GitHub draft/attested public release
  under authorized operator control — **PENDING**.
- [ ] Hostinger customer DNS/TLS, physical Windows enrollment,
  lost-ACK replay and MySQL tenant receipts, encrypted offsite restore
  and security-owner production signoff — **PENDING**.

**Production NOT APPROVED.** N61 acceptance tests are isolated and
synthetic; they neither certify a real signed installer nor claim
remote release publication success.

Related: [N60 acceptance](PHASE-N-STAGE60-ACCEPTANCE.md),
[production checklist](PHASE-N-PRODUCTION-RELEASE-CHECKLIST.md),
[tracked external blockers #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Previously verified baseline

N60 [main CI 44782117865](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44782117865)
completed **4/4 SUCCESS**, including the Windows EXE/MSI lifecycle,
[safety 44782117884](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44782117884)
completed **2/2 SUCCESS**, and
[index 44782117869](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44782117869)
succeeded. Its last documentation-only
[CI 44783129692](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44783129692)
also completed successfully. These runs precede N61 and are not
evidence of an actual manually protected production release.
