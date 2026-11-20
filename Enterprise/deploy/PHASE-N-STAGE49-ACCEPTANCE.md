# Phase N Stage 49 — Per-invocation approval of the OS curl signing certificate

**Status: CODE PROPOSED; PR CI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Finding and remediation

N48 verified that the actual Windows system directory `curl.exe` is an
ordinary signed file, that Authenticode status is valid, its leaf signing
certificate contains `O=Microsoft Corporation`, and its compiled TLS
backend is Schannel. Those checks are necessary, but are **not**
independently pinned to a separately approved publisher certificate: the
local Windows trust store and subject organization text are not an
independent release-owner approval.

N49 adds a separate, operator-supplied `-ApprovedCurlSignerSha256` to
the **optional, per-invocation live** public HTTPS `/healthz` diagnostic.
The value must be **exactly 64 hexadecimal characters** representing
SHA-256 of the signing certificate's `X509Certificate2.RawData` DER bytes.
It is **not** the curl executable SHA-256, the old 40-character SHA-1
`Thumbprint`, an HTTPS server certificate hash, or a TLS public key pin.

The fingerprint must come from an independently reviewed, out-of-band
publisher certificate / Windows release evidence approved by the
organization's security owner. **No production fingerprint is supplied,
inferred from the current host, or recorded as approved in this stage.**
Windows/Microsoft signing certificates may rotate; a changed certificate
requires a fresh independent security approval instead of a silent fallback.

## Implementation

- `Enterprise/deploy/TrustedWindowsSystemCurl.psm1` now exports
  `Assert-PublicWindowsApprovedCurlSignerPin`: strict ASCII-hex 64-character
  admission, SHA-256 over the actual signer certificate DER, 32-byte
  compare without short-circuit on mismatching digest bytes, redacted
  errors and no DNS/network/agent credentials.
- `Assert-PublicWindowsTrustedSystemCurl` requires the approved signer
  SHA-256 argument. Its prior OS-owned path, reparse rejection,
  Authenticode `Valid`, Microsoft organization subject, local native
  `-q --version` and Schannel checks remain mandatory. A mismatched
  signer blocks before application DNS.
- `Enterprise/deploy/Test-WindowsPinnedPublicHttps.ps1` now requires
  `-ApprovedCurlSignerSha256` in addition to exact
  `-ConfirmLive PROBE_PUBLIC_HEALTH` and canonical `-ApprovedOrigin`
  for any live invocation. Missing, malformed or non-hex fingerprints
  fail **before configuration is read**, with no customer DNS, curl
  transport or report overwrite. Fingerprint input is rejected in
  `-DryRun` mode. A well-formed but unapproved fingerprint fails
  locally before DNS and returns only `BLOCKED` redacted evidence.
- Existing N31 automatic `-NetworkProbe` remains **BLOCKED**. No agent,
  MSI, or scheduled action gains a network capability.

## Authorized operator syntax — illustrative only

After external approval of the **exact** signer certificate SHA-256 and
Hostinger origin, the operator would separately supply both approved
values. Do **not** run this command with illustrative placeholders or an
unreviewed local hash:

```powershell
powershell.exe -NoProfile -File .\Enterprise\deploy\Test-WindowsPinnedPublicHttps.ps1 -ConfigPath "C:\ProgramData\ITToolkit-Agent\agent.json" -ReportPath "C:\acceptance\n49-live.json" -ConfirmLive PROBE_PUBLIC_HEALTH -ApprovedOrigin "https://YOUR-ACTUAL-APPROVED-PUBLIC-HOST" -ApprovedCurlSignerSha256 "YOUR-INDEPENDENTLY-APPROVED-64-HEX-SIGNING-CERT-SHA256"
```

Dry-run stays offline and deliberately **does not** accept signer pin or
live consent parameters. A local diagnostic `PASS` never means
`certified_for_production=true`, and the N44 evidence-format audit
still returns `production_approved=false`.

## Regression evidence and limitations

`Enterprise/tests/Test-Stage49WindowsCurlSignerPin.ps1` uses the actual
OS curl signing certificate as a **CI-only self-derived pin** on Windows
PowerShell 5.1 and PowerShell 7. It exercises uppercase/lowercase valid
fingerprints and rejects incorrect but well-formed digests, truncation,
extra digits, prefix, whitespace, separator, non-hex and blank inputs.
The N48 local system curl preflight tests also pass the CI-only hash.
The N43 exact-origin refusal matrix remains offline; its synthetic
signer parameter does not constitute operator approval.

The self-derived CI hash proves only deterministic code compatibility;
it is explicitly **not independent signer approval**. A physical,
customer-approved Windows Microsoft signing-chain review, root
store/revocation policy, certificate rotation, approved Hostinger
public DNS/TLS/CA custody, real customer lost-ACK/MySQL receipts,
publisher-signed release MSI/HSM control, encrypted offsite restore
and integration acceptance remain outside CI. Same-user/administrator
OS tampering and path replacement after validation also remain outside
the assurance boundary.

## Acceptance checklist

- [ ] Windows PowerShell 5.1 and 7 N49 valid/mismatched/malformed pin and
  local Windows-signed curl checks pass; N31–N48 previous safety tests
  remain green with no valid live customer consent.
- [ ] PR Node/Vitest+MySQL, API/MySQL and deployment-safety green.
- [ ] Authorized merge and post-main Windows EXE/MSI build, extraction,
  clean install/uninstall, tenant-preserving major upgrade **4/4**,
  deployment safety **2/2**, signed public artifact upload **SKIPPED**.
- [ ] Independent physical customer Windows signer approval, TLS, Hostinger
  ownership, signed MSI custody, real recovery, offsite restore,
  integrations and customer-security sign-off — **PENDING**.

[Security issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29)
stays OPEN. **Production NOT APPROVED.**
