# Phase N Stage 51 — Offline reviewer-signed Windows curl transport approval

**Status: CODE PROPOSED; WINDOWS PR CI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Security finding and scope

N49 and N50 introduced two separate 64-hex operator-supplied hashes:
the Authenticode **signing certificate DER SHA-256** and the exact Windows
`curl.exe` **file SHA-256**, both required before the operator-consented
public HTTPS health diagnostic could contact a server. However, those
operator inputs were **not cryptographically tied to a particular
approved destination or a security-reviewer-approved, expiring record**.
A valid-looking pair of values is not equivalent to independent security
review. N51 adds a separate, offline reviewer-signature verification
gate **before** any private response directory creation, OS curl or
application DNS.

## Implementation

`Enterprise/deploy/WindowsCurlSignedApproval.psm1` checks an
exact-byte **RSA-SHA256 PKCS#1 v1.5 signature** over a bounded,
canonical, ASCII-LF approval manifest. The public verifier certificate
is a standalone DER X.509 file; its DER SHA-256 is **independently
supplied** as `-ApprovedReviewerCertificateSha256` (exact 64 hex
characters), checked before accepting any signature. Only public RSA
2048–4096-bit keys are accepted; the certificate must be within its
local validity dates. No reviewer private key is needed on the
operator machine, Windows agent, server or CI.

The signed manifest has **exactly seven lines, in the precise order
below, followed by one LF** (not CRLF or BOM):

```text
AADITECH-CURL-APPROVAL-V1
origin=https://YOUR-CANONICAL-APPROVED-PUBLIC-HOST
signer_cert_sha256=YOUR-APPROVED-64-HEX-CURL-SIGNER-CERT-DER-SHA256
curl_binary_sha256=YOUR-APPROVED-64-HEX-CURL-EXE-SHA256
issued_utc=YYYY-MM-DDTHH:MM:SSZ
expires_utc=YYYY-MM-DDTHH:MM:SSZ
approval_id=SECURITY-REVIEW-CHANGE-REFERENCE
```

The **signed bytes** bind the canonical exact HTTPS origin and both
N49/N50 hashes. The issue time cannot be older than 24 hours or more
than five minutes ahead of the local UTC clock; expiry must be
strictly in the future and no more than 24 hours after issue.
Malformed/duplicate/reordered keys, extra lines, non-ASCII bytes,
UTF-8 BOM, whitespace on hash fields, invalid timestamps, incorrect
signature, wrong reviewer DER pin or changed origin/hash fail closed.
Each manifest, signature and reviewer certificate is read as a bounded
ordinary file on a fixed local disk with rejected reparse ancestors
and file-level reparse points; no UNC approval source is accepted.

The optional operator-run
`Enterprise/deploy/Test-WindowsPinnedPublicHttps.ps1` now requires
**four additional parameters in live mode**:
`-ApprovalManifestPath`, `-ApprovalSignaturePath`,
`-ReviewerCertificatePath`,
and `-ApprovedReviewerCertificateSha256`.
The existing `-ConfirmLive PROBE_PUBLIC_HEALTH`,
`-ApprovedOrigin`, `-ApprovedCurlSignerSha256` and
`-ApprovedCurlBinarySha256` gates remain mandatory.
`-DryRun` accepts **none** of the live-only parameters.
The reviewer's signature verifies **before** any local response
workspace, customer DNS or HTTPS. A rejection records only a
redacted `BLOCKED` diagnostic without production certification.
Existing N31 automatic `-NetworkProbe` stays disabled.

## Operator-only example (not an authorization)

```powershell
powershell.exe -NoProfile -File .\Enterprise\deploy\Test-WindowsPinnedPublicHttps.ps1 -ConfigPath "C:\ProgramData\ITToolkit-Agent\agent.json" -ReportPath "C:\acceptance\n51-live.json" -ConfirmLive PROBE_PUBLIC_HEALTH -ApprovedOrigin "https://YOUR-REVIEWED-PUBLIC-HOST" -ApprovedCurlSignerSha256 "YOUR-CURL-SIGNER-CERT-64-HEX" -ApprovedCurlBinarySha256 "YOUR-CURL-EXE-64-HEX" -ApprovalManifestPath "C:\secure-review\curl-approval.txt" -ApprovalSignaturePath "C:\secure-review\curl-approval.sig" -ReviewerCertificatePath "C:\secure-review\reviewer.der" -ApprovedReviewerCertificateSha256 "YOUR-INDEPENDENTLY-REVIEWED-REVIEWER-DER-64-HEX"
```

The command contains placeholders and **cannot be treated as approved
or executed against a customer**. Security owners must review the
actual domain and certificate/binary provenance and independently
pin the reviewer public certificate before accepting this record.
The supplied public verifier certificate alone is **not** a trust
anchor unless its hash is independently approved.

## Regression matrix

`Enterprise/tests/Test-Stage51WindowsCurlSignedApproval.ps1` uses a
**throwaway, locally generated RSA reviewer private key only in CI**
to exercise actual Windows PowerShell 5.1 and PowerShell 7 signing
and verification, exact payload bytes, validity, origin/hash binding,
reviewer certificate pinning, manifest/signature tampering,
expired/future approvals, malformed/duplicate keys, BOM and CRLF.
No customer origin ever receives a DNS lookup or HTTPS transfer,
and no production reviewer key or approval is generated.

## Limitations

RSA signing proves control of the private key corresponding to the
supplied verifier public certificate; it **does not establish** that
the operator-supplied certificate hash was independently approved.
Test-fixture keys and self-signed certificates are **never**
production evidence. Local signed manifests can be replayed during
their short validity window; approval expiration is not an online
revocation or nonce-consumption system. Local clock manipulation,
privileged file replacement, same-user or administrator attacks
and Windows trust-store compromise remain outside this gate.
This does not replace independent review of Microsoft publisher
certificates, public Hostinger DNS/TLS ownership, HSM-controlled
MSI signing, physical lost-ACK replay, offsite recovery and tenant
integrations.

## Acceptance gates

- [ ] Real Windows PowerShell 5.1 and 7 offline N51 reviewer RSA
  signature, canonical manifest and temporal fault-injection tests
  pass with N31–N50 prior safety tests green.
- [ ] PR Node/Vitest+MySQL, API/MySQL and deployment safety pass,
  merge at the verified SHA, then new `main` EXE/MSI lifecycle
  **4/4** plus deployment safety **2/2**.
- [ ] Independently approved reviewer public certificate DER SHA-256,
  real signed approval manifest for exact physical Windows build
  and customer origin, Hostinger DNS/TLS, public publisher-signed
  MSI/HSM, physical queue lost-ACK + MySQL receipts, offsite restore,
  integration acceptance and human security sign-off remain
  **PENDING**.

**Production NOT APPROVED.**
[Security issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29)
stays OPEN.
