# Phase N Stage 46 — Atomic Protected Windows HTTPS Response Workspace

**Status: CODE PROPOSED; FRESH PR CI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Finding

N45 moved the separately consented Windows `/healthz` response out of an
untrusted, caller-supplied TEMP folder into a randomized per-run directory
under the operator's local Windows application-data folder. However, it
originally used `Directory.CreateDirectory(path)` **before** `Set-Acl`.
Even with a randomized path and verification before any DNS or HTTP, the
filesystem could momentarily expose the directory with **inherited access
rules** during the create-then-secure interval.

N46 closes the creation-order gap. The Windows response workspace now uses
a **protected, owner-SID and SYSTEM-only security descriptor as part of the
directory creation operation**.

## Implementation

- `PrivateWindowsProbeWorkspace.psm1` builds a
  `DirectorySecurity` object first, disables access rule inheritance, sets
  current operator SID as owner, and allows only current operator/SYSTEM
  full control with child inheritance. The module then creates a unique
  GUID-named directory with that security descriptor **atomically**:
  - Windows PowerShell 5.1 on .NET Framework:
    `[IO.Directory]::CreateDirectory($directory, $acl)`.
  - PowerShell 7 on modern .NET:
    `[System.IO.FileSystemAclExtensions]::CreateDirectory($acl, $directory)`.
- **No** plain `CreateDirectory(path)`, post-creation `Set-Acl`, or
  permissive fallback is allowed. If the runtime cannot provide the
  ACL-bearing creation method, the probe fails closed *before* DNS.
- Post-create verification still checks owner, protected non-inherited ACL
  and all explicit SIDs before creating the fixed response file with
  `FileMode.CreateNew`. Response-file ACL is also inspected by the N46
  regression. On failed/preexisting directory creation, cleanup does
  **not** delete a folder that the current process did not successfully
  create.
- The N45 `LocalApplicationData`, local-path/reparse-parent rules and
  N39–N43 public address policy, pinned OS curl/Schannel, explicit
  `-ApprovedOrigin` consent, strict bounded health JSON, redacted evidence
  and disabled N31 `-NetworkProbe` are unchanged.

Reference APIs: [DirectoryInfo.Create with DirectorySecurity (Framework)](https://learn.microsoft.com/en-us/dotnet/api/system.io.directoryinfo.create?view=netframework-4.8.1)
and [FileSystemAclExtensions.CreateDirectory (modern .NET)](https://learn.microsoft.com/en-us/dotnet/api/system.io.filesystemaclextensions.createdirectory).

## Acceptance and negative tests

- [ ] N46 standalone no-network regression passes **actual Windows PowerShell
  5.1** and **PowerShell 7**. The test verifies both API paths are present,
  ACL construction precedes creation, no post-create ACL manipulation or
  network calls, unique directories, protected current-user/SYSTEM access,
  and response-file ACLs.
- [ ] Prior N31–N45 PowerShell safety regressions pass unmodified.
- [ ] PR Node/Vitest+MySQL, isolated API/MySQL and deployment safety pass.
- [ ] Authorized merge and post-merge main CI 4/4, including full
  Windows EXE/MSI build, administrative extraction, install/uninstall and
  major upgrade; main deployment-safety 2/2.
- [ ] Independent customer-owned *physical Windows* ACL/TOCTOU security
  review, DNS/TLS and failed-route drills, verified Hostinger domain/CA
  provenance, publisher signed MSI/HSM custody, queue lost-ACK receipts,
  offsite restore and integration acceptance remain external blockers.

## Limitations

The security descriptor is applied during OS directory creation, reducing
the inherited-ACL exposure from N45. It **does not** defend against a
compromised operator SID, administrator/SYSTEM privilege, tampered local
scripts or profile ownership, modified trusted system stores, or prove
physical/customer authenticity. CI runs synthetic and local-file tests only.

N44's evidence format auditor must still report
`production_approved=false` even for a local healthy diagnostic. No
real customer Windows probe, public publisher signing or signed MSI upload
is authorized by this stage. [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29)
stays OPEN. **Production: NOT APPROVED.**
