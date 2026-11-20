# Phase N Stage 50 — Independently approved Windows curl executable SHA-256

**Status: CODE PROPOSED; PR CI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Security finding

N48–N49 verified the operator's Windows-owned `curl.exe` Authenticode
status, Microsoft organization, Schannel TLS backend and a separately
approved SHA-256 of the *signing certificate*. That certificate can sign
multiple distinct binaries. The previous live guard therefore did not
require a separately security-approved **exact executable release
digest**. N50 provides that additional code-integrity boundary, without
asserting a customer Windows / production approval.

## Code changes

- `Enterprise/deploy/TrustedWindowsSystemCurl.psm1` now exports
  `Assert-PublicWindowsApprovedCurlBinaryPin -BinaryPath ...
  -ApprovedBinarySha256 ...`. It requires an exact **64 ASCII hex**
  SHA-256 of the executable **file bytes**, rejecting prefixes,
  whitespace, truncated/oversized/malformed hashes, missing or zero-byte
  files, reparse points and files larger than 64 MiB. It opens the file
  for streaming SHA-256 with `FileShare.Read` and compares all digest
  bytes without a short-circuit. It emits only redacted errors.
- The existing `Assert-PublicWindowsTrustedSystemCurl` now requires
  **both** `-ApprovedSignerSha256` (N49 signing certificate DER)
  and `-ApprovedBinarySha256` (N50 executable bytes), in addition
  to Microsoft-signed, OS-owned `curl.exe` and Schannel. It
  checks executable digest **before and after** native
  `curl -q --version`.
- `Test-WindowsPinnedPublicHttps.ps1` adds a distinct live-only
  `-ApprovedCurlBinarySha256`. The supplied value must pass strict
  syntax checking before workspace creation or customer DNS. The
  live guard passes the operator's separate signer and binary pins
  to the trusted-curl module, then verifies executable bytes
  **again after** the separately authorized HTTPS transfer, before
  accepting even an otherwise healthy response. On failure, the
  redacted evidence stays `BLOCKED`, never production certified.
  The N31 automatic `-NetworkProbe` remains DISABLED.

## Exact operator input distinctions

The security reviewer must independently obtain and approve the **exact
customer Windows version** of both distinct digest types:

| Live-only input | Meaning | SHA-256 computed over |
|---|---|---|
| `-ApprovedCurlSignerSha256` | Previously approved Microsoft signing **certificate** (N49) | DER bytes of `Get-AuthenticodeSignature ... .SignerCertificate.RawData` |
| `-ApprovedCurlBinarySha256` | Approved **curl.exe** release build (N50) | Entire contents of `[Environment]::SystemDirectory\curl.exe` |

**Do not use a locally self-derived hash as independent approval.** Both
fingerprints must be verified against separately controlled Windows
publisher/build and signing evidence, approved by a real security owner,
and re-approved after binary or certificate rotation. No real approved
fingerprints are embedded, supplied or approved by this stage.

An *illustrative only, not authorized to execute* command is:

```powershell
powershell.exe -NoProfile -File .\Enterprise\deploy\Test-WindowsPinnedPublicHttps.ps1 -ConfigPath "C:\ProgramData\ITToolkit-Agent\agent.json" -ReportPath "C:\acceptance\n50-live.json" -ConfirmLive PROBE_PUBLIC_HEALTH -ApprovedOrigin "https://YOUR-REVIEWED-PUBLIC-HOST" -ApprovedCurlSignerSha256 "SECURITY-APPROVED-SIGNER-CERT-DER-SHA256-64-HEX" -ApprovedCurlBinarySha256 "SECURITY-APPROVED-CURL-EXE-SHA256-64-HEX"
```

The example includes placeholders and cannot pass admission as shown.

## Regression and limitation

`Enterprise/tests/Test-Stage50WindowsCurlBinaryPin.ps1` uses only
a **local synthetic binary** for mutation, malformed/missing digest,
empty/missing/directory file and 64 MiB oversize fault injection.
It then computes the **current CI Windows system** executable and
signer digests to exercise the full local preflight on both
PowerShell 5.1 and PowerShell 7. These are test fixtures only:
**self-derived CI hashes are not approved publisher or customer evidence**.

N48 and N49 local tests supply CI-derived executable hash solely for
compatibility, and the earlier N31–N49 regression suites remain mandatory.
No test supplies both correct live consent and an authorized real customer
origin, and no customer HTTPS request occurs.

The digest checks reduce undetected unreviewed binary substitution, but
do **not** prevent an administrator/SYSTEM or compromised same-user
environment from racing file replacement after verification, forged OS
trust, execution with a tampered loader, or unexpected process crash.
Even an exact binary digest does not establish Hostinger DNS ownership,
public server TLS, real tenant evidence or Microsoft HSM custody.

## Acceptance

- [ ] Actual Windows PowerShell 7 and 5.1 N50 synthetic SHA-256
  mutation, malformed pin, empty/missing/large file, and exact OS curl
  verification pass with no customer DNS/HTTP.
- [ ] N31–N49 Windows, Node/Vitest+MySQL, isolated API/MySQL and
  deployment safety pass; PR merged at verified final HEAD.
- [ ] Post-merge main CI 4/4 includes Windows EXE/MSI build,
  administrative extraction, install/uninstall and major upgrade,
  plus deployment safety 2/2. Public signed MSI upload SKIPPED.
- [ ] Independently reviewed exact Windows curl signing certificate
  **and** exact executable release digests, approved Hostinger public
  domain/TLS evidence, real customer physical Windows/queue lost-ACK,
  publisher-signed MSI key custody, offsite restore, integration
  acceptance and independent security sign-off remain **PENDING**.

See [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).
**Production NOT APPROVED.**
