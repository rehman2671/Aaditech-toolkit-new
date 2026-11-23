# P0: Local Windows MSI execution requires independently approved signer and file hashes

**Review-stage code only. No signed MSI, signer approval, Windows installation or publisher custody is claimed.**

Previously both server-generated `/api/v1/agent/install.cmd` and `/api/v1/agent/install.ps1` executed an arbitrary, first-discovered or legacy-named local MSI with elevated permissions **without** checking its exact hash or Authenticode signer, and could continue or show install success when the MSI was missing. This allowed an unsigned or tampered package to bypass the server's MSI distribution approval hash gate when launched locally.

Both generated entrypoints now demand two independent operator-approved 64-hex fingerprints: `AADITECH_APPROVED_MSI_SHA256` for the *exact versioned MSI*, and `AADITECH_APPROVED_SIGNER_CERT_SHA256` for the *actual Authenticode X.509 signer certificate DER bytes*. They reject absent/non-file/reparse-point MSI, hash mismatch, invalid Windows Authenticode status, missing signer certificate or wrong approved certificate, **before** creating config directories, storing device secrets or launching `msiexec`. Neither script chooses the first `*.msi` or treats no-MSI as a successful install. Windows PowerShell 5.1 built-in SHA-256/Authenticode code is used.

These pins are publicly shareable identities, not secrets, but MUST come through an **independently authenticated release-owner channel** and may not be read from an untrusted archive alongside the MSI. A trusted elevated operator must set them in the installer process environment. No real signing approval has been supplied; correct default result is to deny the install.

**Unresolved limits:** Time-of-check/time-of-use replacement of an MSI in a writable folder is still possible after preflight and before `msiexec`; a future signed installer must use privileged immutable staging. The scripts themselves are not Authenticode-verified here; physical Windows signer, revocation and reinstall testing remain required. The separate static `Enterprise/agent/install-agent.cmd` has now been **retired as a permanent fail-closed stub**; it no longer schedules any unsigned PowerShell as SYSTEM. An approved signed MSI workflow must replace legacy direct installation. Operator architecture ADR [#79](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79), disconnected-LAN server installer [#80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80) and protected signed-release policies [#62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62) still block release.

Regression `tests/unit/agent-msi-local-execution-gate.test.js` fetches both scripts and checks signer/hash gates precede writes and MSI execution. Windows PowerShell 5.1/7 syntax and real signed-MSI execution remain unverified release gates.

## ZIP bundle bypass closed in this revision

The public `/api/v1/agent/bundle.zip` previously **always preferred** the legacy static `Enterprise/agent/install-agent.cmd`, which registered an unchecked PowerShell script as SYSTEM; only the standalone `/api/v1/agent/install.cmd` download was generated from the server template. The ZIP now always emits the approved-MSI/hash/Authenticode-gated generated `install-agent.cmd`, and adds `install-agent.ps1` with the same pre-write MSI verification. This prevents a silent fallback to the legacy SYSTEM-task installer in a public ZIP. The legacy checked-in file remains in the repository and must be separately deprecated or independently signed/verified before any direct manual use.

New JSZip runtime regression inspects actual downloaded ZIP bytes and verifies both installer entrypoints are signature/hash gated, with no legacy scheduled SYSTEM PowerShell entrypoint. No production bundle has been built or published.

## Retired static SYSTEM-script installer

The legacy repository file `Enterprise/agent/install-agent.cmd` previously copied unchecked agent PowerShell into ProgramData and registered a persistent SYSTEM task with `-ExecutionPolicy Bypass`, another unsigned-code launch path outside the MSI trust boundary. It now only prints a blocker and exits code **3**: it does not copy scripts, modify permissions/registry, create tasks or import roots. CI includes a native Windows `cmd.exe` regression and source assertions. This intentionally disables the old manual installation shortcut until a signed, reviewed installer workflow exists. Administrators should not attempt to re-enable it to bypass pending signing.
