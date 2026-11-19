# Phase N Stage 40 — Offline Windows HTTPS Endpoint Admission

**Status: MERGED; POST-MERGE MAIN WINDOWS MSI CI 4/4 AND SAFETY 2/2 GREEN; CUSTOMER PRODUCTION NOT APPROVED (verified 2026-11-20 IST).**

## Scope and exact boundary

Windows N31 customer acceptance previously marked `setup=PASS` for syntactically
valid HTTPS telemetry URLs even when the hostname was a loopback/private literal,
a reserved DNS name or an alternate port. This can mislead an operator reviewing
offline preflight evidence; it does **not** mean that the disabled N38 Windows
live probe had actually contacted such an endpoint.

- `Test-PublicWindowsEndpointOrigin` is an **offline** PowerShell 5.1-compatible
  policy exported from the existing N39 address module. It permits only the
  literal `https://<public-shaped-ASCII-DNS-host>[:443]/api/v1/ingest/telemetry`
  syntax, with the N39 strict reserved-domain and DNS-label checks.
- Raw URL shape is checked before URI normalization: userinfo, IP literals,
  non-443 ports, queries, fragments, encoded path aliases, alternate paths,
  whitespace, trailing dots and reserved domains fail closed with a generic
  redacted error. The returned origin is normalized lowercase HTTPS without a
  path/port; no DNS lookup or TLS handshake occurs.
- `Test-CustomerWindowsAcceptance.ps1` uses this shared policy when assessing
  the configured endpoint. The report says the public DNS **name shape**, not
  network ownership or TLS, was checked; `public_https` stays `PENDING` by
  default and remains `BLOCKED` for `-NetworkProbe` as required by N38.
- `Test-Stage40WindowsEndpointPreflight.ps1` covers positive and hostile
  endpoint fixtures, refuses untrusted URL details in error messages, and
  exercises the end-to-end redacted N31 customer report with missing customer
  assets and zero live network calls. All hosts and credentials are synthetic.
- Windows CI executes N40 along with N31/N38/N39, Node/Vitest+MySQL,
  isolated API/MySQL, and deployment-safety checks; PR MSI builds are
  intentionally skipped, requiring a separate post-merge main diagnostic.

## Required verification

- [x] N40 PowerShell policy and integration regression passed on exact merged PR SHA.
- [x] N31/N38/N39, Node/Vitest/MySQL, API/MySQL and deployment-safety PR CI passed.
- [x] Maintainer-authorized merge and post-merge main Windows MSI build,
      extraction, install/uninstall and major-upgrade jobs passed.
- [ ] Independent security review and actual external customer acceptance.

## Non-claims and external blockers

This is **not** live DNS validation, TLS certificate verification, pinning,
redirect/proxy refusal, a successful `/healthz` response, or permission to
enable the Windows `-NetworkProbe`. The live transport remains deliberately
disabled until independently reviewed per [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).
A syntactically valid hostname can still resolve to a private address; this
stage makes **no connection** and never emits `public_https=PASS`.

External Hostinger DNS/TLS and ownership, publisher signing and key custody,
signed public MSI, physical Windows ACK/replay, independent MySQL receipts,
offsite restore and third-party integrations remain **PENDING**.
**Production: NOT APPROVED.**

## Verified prerequisite — N39

[PR #32](https://github.com/rehman2671/Aaditech-toolkit-new/pull/32) merged
as `96adb26a73c8a7dd74c7c20336a62c8fed12deca` on 2026-11-19 UTC.
[Post-merge main CI](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575659496)
passed **4/4** including genuine Windows MSI diagnostics.
[Main deployment safety](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575659160)
passed **2/2**. This is synthetic diagnostic evidence, not public signing,
customer live-host evidence, or an independent security review.

## N40 post-merge CI verification (diagnostic only)

[PR #34](https://github.com/rehman2671/Aaditech-toolkit-new/pull/34)
merged as `4a568f3bd083d91b8b363143e7ab43814004abfd`.
[Main CI #44633379380](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44633379380)
passed **4/4** including genuine Windows EXE/MSI build, extraction,
install/uninstall and major-upgrade lifecycle rehearsal.
[Main deployment safety #44633379367](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44633379367)
passed **2/2** isolated Linux backup/restore safeguards. Publisher-signed
artifact publication was not evidenced; real customer authority and
independent human security approval are still external requirements.

Next: [Stage N41 offline public health JSON validator](PHASE-N-STAGE41-ACCEPTANCE.md).
