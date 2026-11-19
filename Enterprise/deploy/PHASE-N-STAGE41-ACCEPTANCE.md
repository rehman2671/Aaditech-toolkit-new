# Phase N Stage 41 — Offline Windows Public Health JSON Validation

**Status: CODE PROPOSED; FRESH PR CI NOT YET VERIFIED; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Why

The N38 mitigation still **disables** Windows live `-NetworkProbe`. N39 and N40
provide offline public-address and canonical HTTPS endpoint shape validation,
but no PowerShell 5.1-compatible strict structured `/healthz` JSON validator
existed for a future connection-pinned HTTPS transport. Naively checking
response text, or using `ConvertFrom-Json` alone, permits ambiguous duplicate
keys or misleading nested `status`/`database` values.

## Scope

- `Enterprise/deploy/ValidateWindowsHealthJson.psm1` is **offline/pure** and
  accepts only caller-supplied UTF-8 byte arrays; it performs no DNS, HTTP,
  cryptographic operations, process launch or customer system changes.
- Requires at most 65,536 raw bytes, strict UTF-8 decoding without BOM,
  balanced JSON with maximum nesting depth 32 and bounded object key count.
- Pre-scans JSON string tokens, decoding object keys before checking
  case-sensitive duplicates at **all nesting depths**, including escaped
  aliases such as `st\u0061tus` and `status`; then structurally parses
  JSON with Windows PowerShell 5.1-compatible `ConvertFrom-Json`.
- Requires exact top-level string `status="ok"` and exact nested string
  `components.database="HEALTHY"`. Extra well-formed health metadata is
  tolerated to preserve the actual Node `/healthz` schema.
- Rejects malformed, ambiguous, non-UTF-8, oversized, deeply nested,
  duplicate, degraded, false-type or synthetic malicious health JSON with
  one constant redacted denial message; never echoes response bodies.
- `Enterprise/tests/Test-Stage41WindowsHealthJson.ps1` exercises positive
  actual-schema-shaped responses and negative UTF-8, duplicate/escaped-key,
  malformed, nonfinite, type, nesting and length cases with **zero network**.
- GitHub Windows PowerShell validation CI runs N41 alongside N31/N38/N39/N40.

## Required CI and external acceptance

- [ ] PR Windows PowerShell N41 (plus N31/N38/N39/N40), Node/Vitest,
      API/MySQL and deployment-safety checks green on the **exact** head SHA.
- [ ] Authorized merge and post-merge main Windows EXE/MSI diagnostic
      build/extraction/install/uninstall/major-upgrade 4/4, safety 2/2 recorded.
- [ ] Independent human security review of the lexical duplicate-key scanner
      and supported Windows PowerShell/.NET versions.
- [ ] Future explicit operator consent, full public DNS validation, pinned
      trusted-hostname TLS with no proxy/redirect, strict bounded HTTP
      response handling and real customer outside-in evidence.

## Hard stops

This stage **does not** enable the disabled Windows `-NetworkProbe`, resolve
any DNS, connect to `/healthz`, validate a TLS certificate, or report
`public_https=PASS`. Issue #29 stays open. Real Hostinger ownership,
independently approved public trust, key custody and publisher-signed MSI,
physical Windows ACK/queue replay, independent customer database evidence,
offsite restore and live integrations all remain separately **PENDING**.

**Production: NOT APPROVED.**

## Verified N40 prerequisite

[PR #34](https://github.com/rehman2671/Aaditech-toolkit-new/pull/34)
merged into main at `4a568f3bd083d91b8b363143e7ab43814004abfd`.
[Main diagnostic CI #44633379380](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44633379380)
passed **4/4** (PowerShell, Node/Vitest+MySQL, API/MySQL, genuine Windows EXE
and MSI build, extraction, install/uninstall and major upgrade);
[main deployment safety #44633379367](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44633379367)
passed **2/2**. A green main CI is **not** a public signed MSI release or
customer-authorized physical and Hostinger production certification.
