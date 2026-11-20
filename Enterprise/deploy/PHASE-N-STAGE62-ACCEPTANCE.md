# Phase N Stage 62 — Exact Windows EXE/MSI build toolchain admission

**Status: CODE PROPOSED; PR CI AND FRESH MAIN ACCEPTANCE PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-21 IST).**

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

- [ ] PR Windows PowerShell 5.1/7 N62 tests and previous N31–N61
  security regressions, Node/Vitest+MySQL and API/MySQL **3/3**;
  isolated MySQL deployment safety **2/2**.
- [ ] Reviewed PR merged; fresh `main` Windows diagnostic PS2EXE
  **1.0.18** and WiX **5.0.2** EXE/MSI build, administrative extraction,
  real MSI install/clean uninstall and tenant-preserving major
  upgrade **4/4**, safety **2/2**, index refresh.
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
