# Phase N Stage 62 — Exact Windows EXE/MSI build toolchain admission

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; FRESH MAIN PINNED WINDOWS EXE/MSI 4/4 + SAFETY 2/2 SUCCESS; INDEX VERIFIED; PROTECTED SIGNED RELEASE PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-21 IST).**

## Finding and scope

The N61 pipeline still installed the **PS2EXE** compiler with
`Install-Module ps2exe -Force` (the package gallery's latest version)
and WiX using `dotnet tool install --global wix --version "5.*"`
(floating 5.x servicing version). Either build dependency could change
between otherwise identical source commits without an explicit
repository review. This undermines stable Windows EXE/MSI build
rehearsals and complicates per-release supply-chain acceptance.

The published source package versions were independently checked
against [PowerShell Gallery PS2EXE 1.0.18](https://www.powershellgallery.com/packages/ps2exe/1.0.18)
and [NuGet WiX 5.0.2](https://www.nuget.org/packages/wix/5.0.2).
Version pinning is a reproducibility control, **not a downloaded
package digest/SBOM attestation**. Genuine protected signing still
requires all independent N54–N61 reviewer, publisher, SQLite and
release asset admission.

## Implementation

- New `Enterprise/agent/build/toolchain-lock.json` explicitly lists
  **PS2EXE 1.0.18** and **WiX 5.0.2**. The file is strict, bounded and
  cannot contain wildcard/latest version expressions or arbitrary
  extra package keys.
- New `Enterprise/agent/build/BuildToolchainLock.psm1` reads the
  checked-in lock. It compares **exact semantic versions** and rejects
  unexpected downgrade/upgrade, injected multiline/WiX CLI version
  output, malformed/missing metadata and any unapproved tool.
  WiX's optional informational build metadata is accepted **only**
  if its base `major.minor.patch` equals the exact reviewed pin.
- Both diagnostic and manually dispatched production-signable
  `.github/workflows/ci.yml` builds now use
  `Install-Module -Name ps2exe -RequiredVersion 1.0.18 -Repository
  PSGallery ...` and
  `dotnet tool install --global wix --version 5.0.2`. No fallback
  to `latest` or broad `5.*` is permitted.
- `Enterprise/agent/build/build-agent.ps1` now imports the pinned
  module and checks that the callable `ps2exe` command comes from
  the authentic imported PS2EXE module at the exact expected version
  **before invoking the compiler**. A shell alias or unrelated command
  cannot silently replace the compiler.
- `Enterprise/agent/wix/build-msi.ps1` now confirms the installed
  WiX executable's reported `--version` matches the reviewed lock
  **before invoking `wix build`**. This protects direct local invocations
  as well as Actions, including diagnostic builds.
- New `Enterprise/tests/Test-Stage62BuildToolchainLock.ps1` executes
  on **Windows PowerShell 5.1 and PowerShell 7** with offline synthetic
  version inputs. It accepts exact expected versions and rejects
  older/newer/malformed/floating/multiline values, compares the lock
  against actual CI installers and proves both admission calls occur
  before their corresponding build operations.

**Trust boundary:** No production publisher PFX, reviewer private key,
genuine signed MSI, Hostinger endpoint or GitHub Release is required
for this offline test. Exact PS2EXE/WiX versions can still be compromised
or repackaged upstream; independent package digest approval, signed
download provenance, SBOM generation and dependency review remain
additional controls to consider before production release.

## Acceptance

- [x] PR Windows PowerShell 5.1/7 N62 exact-version and earlier
  N31–N61 security regressions, Node/Vitest+MySQL and API/MySQL
  **3/3 SUCCESS**; isolated MySQL deployment safety **2/2 SUCCESS**.
- [x] Reviewed [PR #57](https://github.com/rehman2671/Aaditech-toolkit-new/pull/57)
  merged as `cc8e1f7bcea605c24a2865c7c2b00d5910aca38d`;
  fresh `main` Windows PS2EXE **1.0.18** and WiX **5.0.2** EXE/MSI build,
  administrative extraction, actual MSI installed setup/clean uninstall,
  major upgrade preserving tenant configuration **4/4 SUCCESS**,
  safety **2/2 SUCCESS**, project index refresh successful.
- [ ] Independently vetted production publisher certificate/HSM,
  genuine N56 RSA reviewer-approved short-lived source manifest,
  SQLite ZIP/EXE pins, protected signed CI and real draft-to-public
  release with N59–N61 remote hosted-asset evidence **PENDING**.
- [ ] Customer Hostinger DNS/TLS, physical Windows enrollment and
  lost-ACK MySQL tenant receipts, offsite restore and security-owner
  production approval **PENDING**.

**Production NOT APPROVED.** Do not publish diagnostic EXE/MSI builds
or claim toolchain version pinning substitutes for publisher signing
or an independent source review.

Related: [N61 acceptance](PHASE-N-STAGE61-ACCEPTANCE.md),
[production checklist](PHASE-N-PRODUCTION-RELEASE-CHECKLIST.md),
[release issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Previously verified baseline

[N61 fresh main CI 44799875413](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44799875413)
**4/4 SUCCESS**, [safety 44799875476](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44799875476)
**2/2 SUCCESS**, and index run
[44800919632](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44800919632)
**SUCCESS**. The [N61 documentation-push CI 44800919540](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44800919540)
also completed **4/4 SUCCESS**. All these results precede N62.

## Independently verified N62 GitHub acceptance evidence

- [PR #57](https://github.com/rehman2671/Aaditech-toolkit-new/pull/57)
  reviewed head `8a98a531f4bdb233df518e7ee30fa25a588f88b2`,
  merged as `cc8e1f7bcea605c24a2865c7c2b00d5910aca38d`.
- [PR CI 44820433868](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820433868):
  **3/3 SUCCESS** — N62 exact compiler lock, version downgrade/upgrade,
  malformed and floating rejection on **Windows PowerShell 5.1 and 7**;
  previous N31–N61 controls, Node/Vitest+MySQL and API/MySQL.
  MSI packaging job correctly skipped for pull requests.
- [PR deployment safety 44820433731](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820433731):
  **2/2 SUCCESS** — offline and isolated real MySQL restore safety.
- Fresh [main CI 44820901522](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820901522):
  **4/4 SUCCESS** — full PowerShell suite, Node/Vitest+MySQL,
  API/MySQL and real Windows PS2EXE 1.0.18 EXE + WiX 5.0.2 MSI build;
  administrative extraction, MSI install/clean uninstall and
  tenant configuration-preserving major upgrade all passed.
- [Main deployment safety 44820901397](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820901397):
  **2/2 SUCCESS**; [main index maintenance 44820901328](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44820901328):
  **SUCCESS**.
- On an unsigned automatic push, `Verify final signed artifact
  publication` and `Upload verified signed artifacts only`
  **SKIPPED**, as intended. These were **diagnostic** builds and no
  protected signing credentials, human reviewer manifest, real
  signed GitHub Release or customer Hostinger/physical Windows
  acceptance was executed. **Customer production NOT APPROVED.**

## Release-owner compiler change control (NOT executed on customer systems)

The next legitimate toolchain upgrade must be a reviewed source change
to **all** of `toolchain-lock.json`, the exact PSGallery/NuGet installer
commands in `.github/workflows/ci.yml`, and the N62 negative test pins.
Do not change only an installed package or disable the runtime version
gate to make a CI job pass. Re-run the PowerShell 5.1/7 toolchain tests,
real Windows EXE/MSI extraction, actual MSI install/uninstall and
major upgrade with preserved tenant configuration, followed by a new
independently approved, source-scoped N56 reviewer manifest and signed
artifact publication review.

Before **production** publication, the security owner should also
independently record exact downloaded compiler/package SHA256 and
published package provenance; N62's semver lock alone is not that
cryptographic evidence. Human publisher signing and protected GitHub
draft/public release remain entirely separate approvals.
