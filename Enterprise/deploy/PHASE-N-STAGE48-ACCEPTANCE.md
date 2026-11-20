# Phase N Stage 48 — Windows System Curl Signer / Schannel Preflight

**Status: CODE PROPOSED; PR CI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Security finding

The separately approved Windows pinned HTTPS `/healthz` operator probe
already pinned the OS DNS response, required a matching `-ApprovedOrigin`,
a Microsoft-signed system32 `curl.exe` and a Schannel TLS backend. However,
the **native system curl signing / backend path was not exercised by the
actual Windows test suites**; previous N42/N43 tests exercised only
synthetic argument/HTTP outcomes or disallowed live consent. A future
Windows image, curl update, backend change, or a fragile native command
could break the live path without CI detecting it.

The earlier backend predicate also permitted a `Schannel` string on any
line of `curl --version`, including a forged later `Features:` line.
The Windows signer subject check was a substring test, not a full
organization-attribute match. These are trust-check weaknesses, **not**
evidence that a real customer server was compromised.

## Code and test implementation

- `Enterprise/deploy/TrustedWindowsSystemCurl.psm1` exposes a
  fail-closed local `Assert-PublicWindowsTrustedSystemCurl`. It
  requires the fixed `[Environment]::SystemDirectory\curl.exe`
  ordinary non-reparse file, valid Windows Authenticode signature,
  exact organizational subject attribute `O=Microsoft Corporation`,
  then invokes that same OS executable with only `-q --version`.
  A separately testable parser accepts Schannel **on the leading curl
  version header** with a successful exit code, rejects oversized,
  missing, error-code or forged later-line claims and emits only a
  constant redacted exception on rejection.
- `Test-WindowsPinnedPublicHttps.ps1` removes process CA, proxy,
  backend and keylogging overrides before this validation, and runs
  the **same returned vetted curl binary** for its separately consented
  live GET. The local provenance check occurs **before** resolving the
  operator-approved DNS hostname. A failed check aborts before any
  customer DNS or HTTP and produces a `BLOCKED`, non-production
  diagnostic.
- `Enterprise/tests/Test-Stage48WindowsSystemCurlTrust.ps1` now
  executes real OS Authenticode and native `curl -q --version` on
  **Windows PowerShell 5.1 and PowerShell 7**. Synthetic negative
  fixtures reject OpenSSL, Schannel only on a later line, malformed
  headers, nonzero exit, missing lines and unbounded output. It also
  checks that the operator wrapper validates the binary **before**
  application DNS resolution. It never invokes the live operator mode,
  requests a customer hostname or sends telemetry.
- Existing N31–N47 PowerShell, Node/Vitest+MySQL, API/MySQL,
  isolated backup/restore and Windows MSI lifecycle gates remain
  enabled.

## Trust boundaries / limitations

`Get-AuthenticodeSignature` relies on the operator's Windows trust
store and OS signature/revocation policy; Windows certificate chain
handling may perform infrastructure revocation/discovery checks
depending on host settings. `curl -q --version` itself makes no
customer HTTP request. A certificate organizational attribute and a
valid OS trust-chain **are not an independently pinned Microsoft
publisher certificate**, an independent root-certificate custody audit,
or proof that the Microsoft-owned binary cannot be replaced after
validation by a privileged adversary. An administrator/SYSTEM or an
already-compromised Windows trust store is outside this assurance.
Independent security review of the binary signer and Windows trust
root is still mandatory.

The N44 evidence format auditor must continue to return
`production_approved=false`; a healthy single HTTPS GET, local
OS-curl success, build-signed diagnostics or CI green jobs are NOT
physical customer acceptance or permission to publish a production
MSI.

## Acceptance checklist

- [ ] Actual Windows PowerShell 7 and 5.1 system curl Authenticode,
  non-reparse source and Schannel header pass. Synthetic forged
  headers, exit-code and output limits fail closed.
- [ ] N48 first validates the system binary and restores cleared
  process environment afterward; no approved customer DNS, HTTP or
  live transport occurs during CI.
- [ ] PR PowerShell, Node/Vitest+MySQL, API/MySQL and deployment
  safety green, then authorized PR merge and main CI **4/4**
  including Windows EXE/MSI build, extraction, install/uninstall
  and major upgrade; main deployment safety **2/2**.
- [ ] Independently witness physical customer Windows trust, approved
  Hostinger public DNS/TLS/CA chain, publisher-signed MSI and signing
  key custody, lost-ACK recovery/MySQL receipts, offsite encrypted
  restore, real integrations and human security release approval.

**Production NOT APPROVED.**
[Security issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29)
remains OPEN. N31 automatic live `-NetworkProbe` stays BLOCKED.
