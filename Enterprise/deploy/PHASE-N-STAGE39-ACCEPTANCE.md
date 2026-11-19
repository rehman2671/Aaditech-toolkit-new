# Phase N Stage 39 — Windows Public Address Policy (Offline-Only)

**Status: N39 CODE MERGED; PR CI AND SAFETY PASSED; POST-MERGE MAIN MSI CI PENDING; CUSTOMER PRODUCTION NOT APPROVED (verified 2026-11-19 IST).**

## Purpose

Issue [#29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29) tracks an unsafe Windows live HTTP probe that was removed in merged N38. Stage 39 implements a **Windows-native, PowerShell 5.1-compatible, pure address-validation component** for a future secure pinned TLS transport. It is **not wired into the customer live probe** and makes no DNS lookup, HTTP call, secret disclosure or endpoint changes.

- `Enterprise/deploy/PublicWindowsAddressPolicy.psm1`: accepts a DNS hostname and a supplied set of *offline* literal A/AAAA addresses, checks hostname syntax and reserved domains, rejects any non-public/special IPv4/IPv6 record, mixed public+private sets, IPv4-mapped IPv6, multicast, RFC1918, metadata, documentation and tunnel addresses. Returns a single deterministic IPv4 (preferred) or bracketed IPv6 pin.
- `Enterprise/tests/Test-Stage39WindowsPublicAddressPolicy.ps1`: deterministic offline unit/negative fixtures, redacted denial errors, no network API, mixed-answer refusal.
- Windows PowerShell CI runs the test alongside N31/N38 regressions. No actual customer hostname is resolved.

## Merged code and CI evidence

- [PR #32](https://github.com/rehman2671/Aaditech-toolkit-new/pull/32) merged into `main` as `96adb26a73c8a7dd74c7c20336a62c8fed12deca`, preserving N38's disabled unsafe customer network probe.
- [PR CI #44575178079](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575178079) **SUCCESS 3/3** (PowerShell N39 offline unit/negative tests, Node/Vitest+MySQL, isolated API/MySQL); PR MSI intentionally **SKIPPED**.
- [PR deployment safety #44575178222](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575178222) **SUCCESS 2/2**. These are synthetic offline fixtures; they do not establish customer DNS/TLS evidence.
- Post-merge main [CI #44575659496](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575659496) and [deployment safety #44575659160](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44575659160) need their final GitHub conclusion verified before claiming main MSI diagnostics for N39.

## Verification and limits

- [x] Offline Windows negative tests passed on the exact N39 PR SHA.
- [x] N39 PR PowerShell, Node/Vitest+MySQL and isolated API/MySQL regression passed, plus deployment-safety 2/2.
- [x] Maintainer-authorized N39 PR merge recorded.
- [ ] Verify post-merge main Windows MSI diagnostic lifecycle checks on exact N39 merge SHA.
- [ ] Independent human security inspection of special-use IP ranges and platform support.
- [ ] A separate future Windows native transport provides explicit live operator consent; DNS all-answer validation; hostname-verified TLS with a **connection-time pinned IP**; no proxies or redirects; bounded unambiguous health JSON; refusal/redaction tests and real customer acceptance.

**N39 by itself never initiates DNS/HTTP, never produces `public_https=PASS` and is not evidence of publicly trusted TLS or an operating customer endpoint.** N38 continues to block `-NetworkProbe` on the Windows acceptance script. The external issuer/key custody, publisher-signed MSI, real customer lost-ACK replay, Hostinger TLS/DNS, offsite restore and external integrations remain pending.

N38 merged at `d54325c9323a02152272ceb8f4c35be86fcf2767`; [main CI #44517752267](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44517752267) passed **4/4** including Windows MSI build/extraction/install/uninstall/major upgrade; [main safety #44517752316](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44517752316) passed **2/2**. Publisher-signed release upload was **SKIPPED**.

**Production: NOT APPROVED.**
