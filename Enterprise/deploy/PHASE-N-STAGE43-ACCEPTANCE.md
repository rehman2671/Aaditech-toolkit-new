# Phase N Stage 43 — Exact-origin consent & offline Windows HTTPS fault injection

**Status: MERGED; MAIN CI/MSI 4/4 AND SAFETY 2/2 GREEN; CUSTOMER PRODUCTION NOT APPROVED (verified 2026-11-20 IST).**

## Security objective

N42 introduced a separately operator-consented, public-IP-pinned Windows
`/healthz` diagnostic. Its generic consent token was not cryptographically
or explicitly bound to the *configured hostname*: an operator could approve a
probe before a mutable configuration changed. N43 makes an independent,
explicitly typed **canonical HTTPS origin** mandatory for every live call, and
adds an offline, testable response/outcome decision function with a hard
response-file length bound **before** payload allocation.

The original N31/N38 `-NetworkProbe` path stays **BLOCKED**. N43 does not
activate any agent/MSI automatic network activity, real customer probe or
signed public MSI publication.

## Changes

1. `Enterprise/deploy/Test-WindowsPinnedPublicHttps.ps1` accepts
   `-ApprovedOrigin` on **live** calls. Live is refused before configuration
   read unless **both** `-ConfirmLive PROBE_PUBLIC_HEALTH` and a nonempty
   `-ApprovedOrigin` are present. After N40 validates the configured
   endpoint, the supplied approved origin must be **exactly, case-sensitively**
   equal to the derived canonical origin (`https://public.example.tld`),
   with **no port, path, userinfo, query, fragment or normalization**.
   Mismatch produces only redacted `BLOCKED` evidence and aborts **before**
   calling the resolver, curl or an HTTP client. Dry run cannot be combined
   with either live consent field.
2. `Enterprise/deploy/PublicWindowsPinnedTls.psm1` exports
   `Assert-PublicWindowsPinnedHealthResult`, a **pure offline** final
   health-result policy. It rejects any nonzero native curl exit code,
   missing/multiple/nonexact `200` status lines, absent/empty/directory/
   reparse-point/oversized response files, malformed or degraded N41 JSON.
   It checks file metadata before opening, and rechecks the opened handle's
   size (1–65,536 bytes) before allocating a bounded buffer. An exclusive
   read avoids accepting a simultaneously rewritten response and checks
   short reads. All exceptions have a single non-sensitive message.
3. `Enterprise/tests/Test-Stage43WindowsPinnedHttpsFaults.ps1` injects
   synthetic outcome tuples without sockets: DNS failure, connect failure,
   timeout, TLS/cert failure, curl-size-limit, 3xx redirects, 4xx/5xx,
   status-line spoofing, body missing/too large, malformed/bogus/degraded
   JSON, invalid UTF-8/BOM, and a valid exactly-64-KiB response.
   It also starts the **actual operator script only in offline dry-run or
   declined/host-mismatched consent modes**, proving no live endpoint is
   contacted and that reports remain redacted/unapproved. A source-order
   assertion keeps the origin check before the DNS lookup.
4. GitHub Windows CI executes those tests on both PowerShell 7 and **actual
   Windows PowerShell 5.1**, alongside existing N31–N42, Node/Vitest/MySQL,
   API/MySQL, and deployment-safety suites. No CI test supplies a matching
   live origin and live confirmation together.

## Updated operator usage

Dry run remains **strictly offline**:

```powershell
powershell.exe -NoProfile -File .\Enterprise\deploy\Test-WindowsPinnedPublicHttps.ps1 -ConfigPath "C:\ProgramData\ITToolkit-Agent\agent.json" -ReportPath "C:\acceptance\n43-offline.json" -DryRun
```

Only after the operator has independently confirmed the **exact owned
production DNS name** and received authorization for a read-only connection:

```powershell
powershell.exe -NoProfile -File .\Enterprise\deploy\Test-WindowsPinnedPublicHttps.ps1 -ConfigPath "C:\ProgramData\ITToolkit-Agent\agent.json" -ReportPath "C:\acceptance\n43-live.json" -ConfirmLive PROBE_PUBLIC_HEALTH -ApprovedOrigin "https://YOUR-ACTUAL-APPROVED-PUBLIC-HOST" -ApprovedCurlSignerSha256 "YOUR-INDEPENDENTLY-APPROVED-64-HEX-SIGNING-CERT-SHA256" -ApprovedCurlBinarySha256 "SECURITY-APPROVED-CURL-EXE-SHA256-64-HEX" -ApprovalManifestPath "C:\secure-review\curl-approval.txt" -ApprovalSignaturePath "C:\secure-review\curl-approval.sig" -ReviewerCertificatePath "C:\secure-review\reviewer.der" -ApprovedReviewerCertificateSha256 "INDEPENDENTLY-APPROVED-REVIEWER-DER-SHA256-64-HEX"
```

The illustrative `YOUR-ACTUAL-APPROVED-PUBLIC-HOST` is **not** a deployable
value. It must match the canonical configured telemetry host **exactly**.
A live `PASS` means one diagnostic passed local OS-curl/Schannel/health
checks; it never certifies global DNS ownership, public CA custody, customer
security approvals, production readiness or the physical ACK/outage path.
Do not invoke the live form on a real customer endpoint without independent
approval. New report filenames must not exist.

## Verification gates

- [x] N43 Windows PowerShell 7 and **5.1** offline negative tests passed.
- [x] PR Node/Vitest+MySQL, API/MySQL and deployment-safety suites passed.
- [x] PR #38 merged with verified head; new main Windows MSI diagnostic 4/4
  (EXE/MSI build/extract/install/uninstall/upgrade) plus safety 2/2 passed.
- [ ] Independent review of OS curl/Schannel, native exit handling, local
  temp-file ownership/ACL, signed executable provenance, and DNS answer
  completeness on approved physical Windows.
- [ ] Approved external real Hostinger TLS/public authoritative DNS and
  customer-owned hostname check, physical Windows timeout/redirect/cert
  fault tests, signed publisher MSI and offsite restore proof.
- [ ] Real auth-enrolled device queue lost-ACK replay/receipts and live
  integrations independently witnessed.

**Production: NOT APPROVED.** [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29)
remains OPEN until transport and customer acceptance are independently verified.

## Verified source/CI evidence — not customer approval

- [PR #38](https://github.com/rehman2671/Aaditech-toolkit-new/pull/38) merged verified head `21addbdd11e9c77552aa53ee4c3aa8018bab0fdc` to `main` as `d6a974d7c1fb24cd292051a98a3ba7824cf22069` after PowerShell 7/Windows PowerShell 5.1 N43 offline negative tests, Node/Vitest+MySQL, API/MySQL and deployment-safety passed.
- [Main CI #44647657565](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44647657565) **4/4 SUCCESS**: PowerShell, Node/Vitest+MySQL, API/MySQL and Windows EXE/MSI build, Windows Installer administrative extraction, fresh install/uninstall and major-upgrade/tenant-config preservation.
- [Main safety #44647657434](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44647657434) **2/2 SUCCESS**: bash/offline recovery and isolated MySQL backup/restore.
- The diagnostic MSI signature-validation workflow step passed but **`Upload verified signed artifacts only` was SKIPPED**. This is not approved production code-signing or signed public installer publication.
- No real customer Windows DNS/TLS fault injection, Hostinger ownership verification, independent security review, physical queue ACK proof or offsite restore is provided by synthetic CI. N31 `-NetworkProbe` remains BLOCKED and Issue #29 remains OPEN.

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
