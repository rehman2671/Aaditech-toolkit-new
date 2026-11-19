# Phase N Stage 38 — Fail-Closed Customer Windows Live-Probe Mitigation

**Status: PR CODE/CI GREEN; INDEPENDENT REVIEW & STACKED N36/N37 MERGES PENDING; CUSTOMER PRODUCTION NOT APPROVED (verified 2026-11-19 IST).**

## CI evidence (not customer acceptance)

- [N38 PR #30](https://github.com/rehman2671/Aaditech-toolkit-new/pull/30) code SHA `5b596d347f5b7eebc491e95aa553d6866f2cf2f5`.
- [Full PR CI #44405914078](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44405914078): **SUCCESS**, Windows PowerShell (including N38 regression), Node/Vitest+MySQL 8 and isolated API/MySQL 8; the genuine Windows EXE/MSI build is **SKIPPED** on pull requests.
- [Deployment safety #44405914047](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44405914047): **SUCCESS 2/2** (offline preflights and isolated MySQL backup/restore).
- The tests establish **refusal of unsafe network access**, not successful secure live Windows HTTPS or physical customer certification. The requested independent reviewer `rehman2671` has not yet submitted approval. Any later code/docs SHA, retargeting or merge requires fresh CI verification.

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

- [x] Windows CI syntax and N31/N32 acceptance regressions pass.
- [x] `Test-Stage38WindowsNetworkProbe.ps1` confirms direct web/socket
      transport is absent and a configured-looking synthetic endpoint cannot
      cause a network request; requested live produces `public_https=BLOCKED`.
- [x] Default offline invocation produces `public_https=PENDING`.
- [x] Both cases create redacted, unoverwriteable and non-certified reports;
      no synthetic secret or host is printed.
- [x] Full PR CI and isolated MySQL API tests successful on exact code head.
- [ ] Independent N36/N37/N38 reviews, authorized merges, retargeted checks and main MSI diagnostic certification.

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
