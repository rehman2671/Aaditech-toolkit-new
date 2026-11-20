# Phase N Stage 39 — Windows Public Address Policy (Offline-Only)

**Status: MERGED; N39 MAIN CI/MSI 4/4 AND DEPLOYMENT SAFETY 2/2 PASSED; CUSTOMER PRODUCTION NOT APPROVED (verified 2026-11-20 IST).**

## Purpose

Issue [#29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29) tracks an unsafe Windows live HTTP probe that was removed in merged N38. Stage 39 implements a **Windows-native, PowerShell 5.1-compatible, pure address-validation component** for a future secure pinned TLS transport. It is **not wired into the customer live probe** and makes no DNS lookup, HTTP call, secret disclosure or endpoint changes.

- `Enterprise/deploy/PublicWindowsAddressPolicy.psm1`: accepts a DNS hostname and a supplied set of *offline* literal A/AAAA addresses, checks hostname syntax and reserved domains, rejects any non-public/special IPv4/IPv6 record, mixed public+private sets, IPv4-mapped IPv6, multicast, RFC1918, metadata, documentation and tunnel addresses. Returns a single deterministic IPv4 (preferred) or bracketed IPv6 pin.
- `Enterprise/tests/Test-Stage39WindowsPublicAddressPolicy.ps1`: deterministic offline unit/negative fixtures, redacted denial errors, no network API, mixed-answer refusal.
- Windows PowerShell CI runs the test alongside N31/N38 regressions. No actual customer hostname is resolved.

## Verification and limits

- [x] Offline Windows negative tests passed against the merged PR SHA.
- [x] PowerShell, Node/Vitest+MySQL and real isolated API/MySQL regression passed; deployment-safety 2/2.
- [x] Maintainer-authorized merge and **post-merge main Windows MSI** diagnostic lifecycle checks passed.
- [ ] Independent human security inspection of special-use IP ranges and platform support.
- [x] Subsequent N40–N42 code added offline endpoint admission, strict bounded JSON checking and a **separately consented Windows pinned HTTPS operator diagnostic**; [N42 main CI #44643192250](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44643192250) passed **4/4**, [main safety #44643192246](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44643192246) passed **2/2**.
- [ ] Perform a customer-approved real Windows pinned-TLS probe with independent public DNS/CA evidence, signed release, offsite restore and physical customer ACK; CI alone cannot close this gate.

**N39 by itself never initiates DNS/HTTP, never produces `public_https=PASS` and is not evidence of publicly trusted TLS or an operating customer endpoint.** N38 continues to block `-NetworkProbe` on the Windows acceptance script. The external issuer/key custody, publisher-signed MSI, real customer lost-ACK replay, Hostinger TLS/DNS, offsite restore and external integrations remain pending.

N38 merged at `d54325c9323a02152272ceb8f4c35be86fcf2767`; [main CI #44517752267](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44517752267) passed **4/4** including Windows MSI build/extraction/install/uninstall/major upgrade; [main safety #44517752316](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44517752316) passed **2/2**. Publisher-signed release upload was **SKIPPED**.

**Production: NOT APPROVED.**

## N39 post-merge verification (not customer acceptance)

[PR #32](https://github.com/rehman2671/Aaditech-toolkit-new/pull/32) merged
at `96adb26a73c8a7dd74c7c20336a62c8fed12deca` (2026-11-19 UTC).
[Main CI #44575659496](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575659496)
passed **4/4** including Windows MSI build, extraction, install/uninstall and
major upgrade; [main deployment safety #44575659160](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575659160)
passed **2/2**. Public publisher-signed artifact publication was not evidenced.
A maintainer-authorized merge and passing synthetic CI are not an independent
human security assessment or actual customer DNS/TLS/production acceptance.

This pure N39 module was subsequently consumed by [N40 offline endpoint admission](PHASE-N-STAGE40-ACCEPTANCE.md), [N41 strict health JSON](PHASE-N-STAGE41-ACCEPTANCE.md) and [N42 optional pinned Windows HTTPS operator diagnostic](PHASE-N-STAGE42-ACCEPTANCE.md). N31's original unsafe `-NetworkProbe` remains disabled; N42 requires separate explicit operator consent. No physical customer system was tested by these automated CI jobs.
