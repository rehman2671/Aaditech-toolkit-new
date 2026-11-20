# Phase N Stage 42 — Separately consented Windows pinned public HTTPS probe

**Status: MERGED; POST-MERGE MAIN CI/MSI 4/4 AND DEPLOYMENT-SAFETY 2/2 GREEN; CUSTOMER PRODUCTION NOT APPROVED (verified 2026-11-20 IST).**

## Why and isolation

N38 deliberately disabled the previous unsafe Windows `-NetworkProbe` route
following a DNS-rebinding/redirect SSRF gap ([Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29)).
N39 through N41 introduced independently testable **offline** public A/AAAA
address admission, strict configured endpoint shape and bounded duplicate-safe
health JSON parsing. N42 adds a **separate, opt-in read-only operator diagnostic**,
not an automatic live request from N31, the MSI, the agent or a scheduled task.
The N31 `-NetworkProbe` branch stays **BLOCKED**.

## Implementation

- `Enterprise/deploy/PublicWindowsPinnedTls.psm1` exports a **pure offline**
  `New-PublicWindowsPinnedCurlArguments`. It reuses the N39/N40 policy to
  refuse all invalid/special/mixed DNS literals, then constructs one HTTPS
  GET `/healthz` request. Curl options require first-argument `-q` (ignore
  curlrc), `--resolve HOST:443:PIN` (pin actual connection), `--noproxy '*'`,
  `--proto '=https'`, `--tlsv1.2`, `--max-redirs 0`, bounded time/size,
  a response file and an HTTP-status-only stdout. No `-L`, `-k`,
  `--insecure`, `--cacert`, credentials, POST body or headers are allowed.
- `Enterprise/deploy/Test-WindowsPinnedPublicHttps.ps1` **refuses any live
  mode unless** `-ConfirmLive PROBE_PUBLIC_HEALTH` is supplied per invocation.
  It reads the already locally configured HTTPS telemetry endpoint; never
  transmits the agent token or tenant/device identity. `-DryRun` is strictly
  offline, mutually exclusive with live consent, records PENDING and no
  network/TLS claim. Missing or malformed consent fails before reading config,
  resolving DNS or opening a report.
- With explicit live consent on Windows, the OS resolver returns A/AAAA
  addresses for the configured host, **all returned addresses** are checked
  by N39 and a deterministic public address is pinned into curl for the
  actual connection. No ordinary second curl DNS resolution, URL redirect or
  proxy connection is requested. Resolver results are **not** proof of every
  globally published authoritative DNS answer. Hostname is retained in the
  HTTPS URL for TLS SNI and certificate-hostname verification.
- Uses the OS `System32\curl.exe`, requires a valid Microsoft Authenticode
  signature and a Schannel-native TLS backend. Clears caller-controlled curl
  CA/backend, proxy and SSL key-log environment overrides around invocation.
  The system's CA trust may contain private roots; OS trust **does not** prove
  independent public-CA approval or external Hostinger ownership.
- Requires HTTPS status exactly **200**, no curl failure, a response size
  `1..65536` bytes, and the already-tested N41 exact structured JSON
  status `ok` / `components.database=HEALTHY`. Curl output and all failures
  are redacted; response bytes are deleted from a temporary directory after
  the attempt. An exclusive CreateNew JSON report never includes the
  configured URL, resolved addresses, headers, body, tokens or tenant identity.
- All reports retain `certified_for_production=false` and outstanding physical
  ACK replay, publisher signing, live Hostinger, operator security review and
  integration gates, **even if this one diagnostic reports PASS**.

## Operator example (requires prior customer authorization)

Dry run, which never contacts a network:

```powershell
powershell.exe -NoProfile -File .\Enterprise\deploy\Test-WindowsPinnedPublicHttps.ps1 -ConfigPath "C:\ProgramData\ITToolkit-Agent\agent.json" -ReportPath "C:\acceptance\n42-offline.json" -DryRun
```

After **independent approval of the actual customer hostname and live probe**,
an operator may invoke the explicitly consented read-only check:

```powershell
powershell.exe -NoProfile -File .\Enterprise\deploy\Test-WindowsPinnedPublicHttps.ps1 -ConfigPath "C:\ProgramData\ITToolkit-Agent\agent.json" -ReportPath "C:\acceptance\n42-live.json" -ConfirmLive PROBE_PUBLIC_HEALTH -ApprovedOrigin "https://YOUR-ACTUAL-APPROVED-PUBLIC-HOST" -ApprovedCurlSignerSha256 "YOUR-INDEPENDENTLY-APPROVED-64-HEX-SIGNING-CERT-SHA256" -ApprovedCurlBinarySha256 "SECURITY-APPROVED-CURL-EXE-SHA256-64-HEX" -ApprovalManifestPath "C:\secure-review\curl-approval.txt" -ApprovalSignaturePath "C:\secure-review\curl-approval.sig" -ReviewerCertificatePath "C:\secure-review\reviewer.der" -ApprovedReviewerCertificateSha256 "INDEPENDENTLY-APPROVED-REVIEWER-DER-SHA256-64-HEX"
```

**Stage N43 amendment:** The CLI above now requires an independently typed,
exact canonical `-ApprovedOrigin` matching the configured endpoint host; the
example placeholder must be replaced with the customer-approved hostname.
The N43 offline shared result validator also bounds response files *before*
reading. See [N43 acceptance](PHASE-N-STAGE43-ACCEPTANCE.md).

Use fresh, previously nonexistent report paths. This is a read-only health
GET, **not** production acceptance or an agent installer activation.

## Verification and remaining blockers

- [x] Windows PowerShell 7 and **actual Windows PowerShell 5.1** CI offline
      negative tests: consent refusal, dry-run zero network, mixed/private
      A/AAAA denial, IPv6 pin, correct locked curl arguments, redacted
      immutable reports, and N31 probe stays disabled.
- [x] Node/Vitest+MySQL and isolated API/MySQL PR CI green, deployment-safety 2/2.
- [x] Authorized PR #36 merge and main Windows MSI diagnostic
      build/extract/install/uninstall/major-upgrade 4/4, safety 2/2 passed.
- [ ] Independently security-review native curl assumptions, signature and
      trust behavior, Windows DNS result completeness, local file ACLs,
      potential transparent network interception and proxy bypass.
- [ ] Customer-approved **physical Windows** online/failed-route tests,
      independently recorded actual DNS/TLS certificate ownership and public
      chain, Hostinger outside-in checks and offsite restore.
- [ ] Publisher-signing HSM/issuer custody, signed public MSI publication,
      authenticated lost-ACK MySQL receipts and live integrations.

**Issue #29 remains OPEN** until the real customer transport is independently
certified and an appropriately reviewed decision about integrating the
previously disabled N31 `-NetworkProbe` is made. **Production: NOT APPROVED.**

## Verified N42 source and diagnostic CI (not external release acceptance)

- [PR #36](https://github.com/rehman2671/Aaditech-toolkit-new/pull/36) merged to `main` as `ac904c6b98edd622ccd217c14edfce3e49108e69` after the final PR head `10b77725263938a051c33561498e350405639eaa` passed Windows PowerShell 7/5.1 N42 offline tests, Node/Vitest+MySQL, isolated real API/MySQL and deployment safety.
- [Main CI #44643192250](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44643192250) **4/4 SUCCESS**: PowerShell, Node/Vitest+MySQL, API/MySQL and Windows EXE/MSI build, administrative extraction, fresh install/uninstall and major-upgrade rehearsal.
- [Main safety #44643192246](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44643192246) **2/2 SUCCESS**: offline deployment safeguards and disposable MySQL backup/restore rehearsal.
- Diagnostic `Verify pre-signed MSI payload and sign release MSI` job step completed in **diagnostic mode**; `Upload verified signed artifacts only` was **SKIPPED**. No publicly signed MSI or customer production publisher-key custody has been approved.
- **No customer live probe, independent code audit, public Hostinger ownership/TLS, physical ACK replay or offsite restore** was evidenced by CI. The N31 `-NetworkProbe` remains disabled and Issue #29 remains open.

## N49 trust pin amendment (mandatory on all separately authorized LIVE calls)

The N42/N43 historical live example above now includes the later N49
`-ApprovedCurlSignerSha256` parameter. This is the independent
security-owner-approved SHA-256 of the **Windows system curl Authenticode
leaf signing certificate DER**, NOT the curl EXE, HTTPS server certificate,
or a locally self-derived production approval. Omit the parameter during
`-DryRun`. A live request without an externally approved value is blocked
before customer DNS. See [N49 acceptance](PHASE-N-STAGE49-ACCEPTANCE.md).
No customer live request, independently authorized fingerprint or public
signed MSI was supplied by N49.

## N50 executable release digest amendment

The optional *live* Windows `/healthz` command now also **requires**
`-ApprovedCurlBinarySha256`: a separate independently security-approved
64-hex SHA-256 over the exact OS `curl.exe` file bytes, distinct from N49's
signer-certificate DER hash. Historical live examples above have been amended
where present. No such hash is automatically inferred as production approval.
The binary is checked before customer DNS and again after the optional HTTPS
transfer; even a healthy response remains non-production-certified. See
[N50 acceptance](PHASE-N-STAGE50-ACCEPTANCE.md). Physical customer trust,
Hostinger and publisher signing acceptance remain PENDING.

## N51 mandatory signed reviewer approval amendment

Historical operator commands in this document are superseded by the **N51**
live-only requirement for `-ApprovalManifestPath`, `-ApprovalSignaturePath`,
`-ReviewerCertificatePath` and
`-ApprovedReviewerCertificateSha256`. An RSA-SHA256 signed canonical
approval must bind the exact HTTPS origin and both N49/N50 curl digests,
expire within 24 hours and be verified using a separately approved
reviewer public certificate DER SHA-256 **before customer DNS**. No
reviewer hash or signed manifest has been independently approved here.
Do not infer approval from a CI-only test certificate or local key.
See [N51 acceptance](PHASE-N-STAGE51-ACCEPTANCE.md); production stays BLOCKED.
