# Phase N Stage 45 — Windows private response workspace for pinned HTTPS diagnostics

**Status: CODE PROPOSED; PR CI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Finding and objective

The separately operator-consented N42/N43 Windows `/healthz` diagnostic previously
wrote a JSON response into a GUID-named directory below the **process TEMP
path**, inherited whatever ACLs that directory's parent provided, and did not
create the response file exclusively before handing it to curl. A redirected
TEMP path, permissive inherited ACL or malicious output symlink could expose
untrusted health response data or redirect an elevated operator's file write.
The response is strictly bounded and contains no agent credentials, but
file-handling trust boundaries still matter.

N45 isolates the Windows diagnostic output in the **current Windows account's
LocalApplicationData** tree, never a process-provided TEMP/TMP root. A new
128-bit random directory is created and its discretionary ACL inheritance
**disabled**; only the current account SID and the Windows SYSTEM SID receive
explicit FullControl. Owner, inheritance and every allowed SID are checked
before returning, and a fixed `response.json` is preallocated with
`FileMode.CreateNew`, not reused or overwritten. Failures throw a redacted
error and remove the temporary workspace. If the operator profile lacks
usable LocalAppData, ownership or ACL support, the live request must fail
closed rather than fall back to public TEMP.

## Code and CI

- `Enterprise/deploy/PrivateWindowsProbeWorkspace.psm1`: pure local Windows
  filesystem helper, no DNS, network, curl, registry or customer secrets.
  Refuses UNC/redirection/reparse ancestry and verifies protected ACLs
  before exposing the return path.
- `Enterprise/deploy/Test-WindowsPinnedPublicHttps.ps1` now creates the
  workspace and fixed exclusive response target **before DNS resolution**
  and native curl invocation. A failing workspace policy returns a generic
  `BLOCKED` report at diagnostic phase `PRIVATE_WORKSPACE`; the N31
  automatic `-NetworkProbe` route remains **BLOCKED**.
- `Enterprise/tests/Test-Stage45WindowsPrivateProbeWorkspace.ps1` verifies
  owner/SYSTEM-only ACLs, no inherited rules, unique per-run directories,
  non-reparse and exclusively created empty file targets, refusal to reuse
  the response file, and resistance to caller-overridden TEMP/TMP.
  Actual Windows PowerShell 5.1 and PowerShell 7 runners execute these tests
  **without** DNS, HTTP or a valid live-consent invocation.
- The original N39–N44 and MySQL/Node/API/deployment-safety gates remain in CI.

## Security scope

This provides cross-account filesystem isolation, **not** an atomic kernel
attestation against a compromised operator SID, administrators who can take
ownership, SYSTEM, or a locally tampered PowerShell script. A transient ACL
inheritance interval may exist during directory creation before its explicit
protected ACL is set; the workspace uses a cryptographically randomized name
under the account's own local profile and cannot be used before verification.
Independent security review must assess this window and any enterprise
profile redirection or endpoint protection interactions on actual customer
Windows hosts.

N45 does **not** prove real DNS, customer-owned Hostinger TLS/CA custody,
authenticity or freshness of N44 unsigned evidence, publisher signing,
physical lost-ACK recovery, offsite restore or integrations. The N44 format
auditor always outputs `production_approved=false`.

## Acceptance checklist

- [ ] N45 actual Windows PowerShell 7 and 5.1 private-workspace regression green.
- [ ] Node/Vitest+MySQL and API/MySQL PR CI and deployment safety green.
- [ ] Authorized merge and new main Windows EXE/MSI build, administrative
      extraction, install/uninstall and major-upgrade regression **4/4**;
      deployment safety **2/2**.
- [ ] Independent security review of file ACL semantics, current profile
      redirection, temp cleanup, curl output file ownership and operator trust.
- [ ] Real customer-approved physical Windows HTTPS failure drill; customer
      Hostinger public DNS/TLS ownership, signed MSI/HSM custody, MySQL lost-ACK
      replay, encrypted offsite restore and integration acceptance.

**Production NOT APPROVED.** [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29)
stays OPEN; N31 live `-NetworkProbe` stays disabled.
