# Phase N Stage 38 — Fail-Closed Customer Windows Live-Probe Mitigation

**Status: CODE PROPOSED; PR CI AND INDEPENDENT REVIEW PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-19 IST).**

Related tracking: [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).

## Confirmed problem and immediate fix

The existing `Enterprise/tests/Test-CustomerWindowsAcceptance.ps1` contained a
PowerShell `Invoke-RestMethod` live health probe behind only `-NetworkProbe`.
A hostname syntax check was insufficient to stop a previously public DNS name
from resolving to private/metadata IP addresses or redirecting to an internal
destination. There was no pinned transport and no explicit no-proxy/no-redirect
enforcement. Consequently `public_https=PASS` could have been misleading.

**Immediate N38 mitigation:** remove the unpinned live request entirely.
The script remains a **strictly offline** inventory/queue/signature evidence
collector. With no `-NetworkProbe`, it writes `public_https=PENDING` as before;
with `-NetworkProbe`, it writes `public_https=BLOCKED` with an explicit
safety reason and returns nonzero. No DNS query or HTTP connection is
attempted by either path. The report always preserves
`certified_for_production=false`, redaction and exclusive `CreateNew` semantics.

## Automated checks

- [ ] Windows CI syntax and N31/N32 acceptance regressions pass.
- [ ] `Test-Stage38WindowsNetworkProbe.ps1` confirms direct web/socket
      transport is absent and a configured-looking synthetic endpoint cannot
      cause a network request; requested live produces `public_https=BLOCKED`.
- [ ] Default offline invocation produces `public_https=PENDING`.
- [ ] Both cases create redacted, unoverwriteable and non-certified reports;
      no synthetic secret or host is printed.
- [ ] Full PR CI, isolated MySQL API tests and independent review pass.

## What is intentionally NOT done

This is a **safety mitigation**, not completion of Windows live networking
or customer TLS certification. A future native Windows endpoint probe needs
explicit per-invocation operator confirmation, all-answer A/AAAA validation,
pinned destination with trusted hostname-verified TLS, proxy/redirect refusal,
strict bounded JSON parser and deterministic offline negative tests. The
Linux N37 Hostinger CLI has these separate controls, but is not a substitute
for a certified Windows-probe implementation. Issue #29 **remains open** until
that complete work and real customer-approved evidence exist.

Stacked merge dependencies are N36 PR #27, N37 PR #28, then this N38 PR.
All require independent review; N37 must be retargeted/merged before N38 is
retargeted onto main. PR CI cannot certify actual physical Windows outage,
authenticated server ACK, public Hostinger DNS/TLS, external operator signing,
offsite restore, public signed MSI or live third-party integrations.

**Release decision: NOT APPROVED.**
