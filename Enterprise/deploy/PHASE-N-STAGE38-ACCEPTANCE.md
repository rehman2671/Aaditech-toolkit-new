# Phase N Stage 38 — Fail-Closed Customer Windows Live-Probe Mitigation

**Status: N36/N37 MERGED INTO MAIN; N38 SAFETY PATCH RECONCILED ON MAIN VIA PR #31; FRESH PR CI / MAIN MSI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-19 IST).**

## CI evidence (not customer acceptance)

- [N38 reconciled PR #31](https://github.com/rehman2671/Aaditech-toolkit-new/pull/31) rebases the **five scoped N38 changes** onto the latest main after [N37 PR #28](https://github.com/rehman2671/Aaditech-toolkit-new/pull/28) merged at `871f2e3900aae26f2abe4d9d9a93544700243c0f`. It replaces the now-conflicted [original PR #30](https://github.com/rehman2671/Aaditech-toolkit-new/pull/30) without overwriting accepted N37 DNS/health/security controls.
- [Full PR CI #44405914078](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44405914078): **SUCCESS**, Windows PowerShell (including N38 regression), Node/Vitest+MySQL 8 and isolated API/MySQL 8; the genuine Windows EXE/MSI build is **SKIPPED** on pull requests.
- [Deployment safety #44405914047](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44405914047): **SUCCESS 2/2** (offline preflights and isolated MySQL backup/restore).
- Prior #30 CI evidence above establishes the fail-closed mitigation on the **old base**, not a new #31 pass. Verify **fresh #31 CI and deployment safety** before main merge and check **post-merge main MSI diagnostics** separately. This is an owner-authorized workflow and must not be misrepresented as independent human security review.
- The tests establish **refusal of unsafe network access**, not successful secure live Windows HTTPS or physical customer certification.

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
- [x] Original N38 #30 CI and isolated MySQL API tests passed on the older N37 base.
- [ ] Reconciled N38 #31 CI and deployment safety pass on the latest main-based head.
- [ ] Post-merge main Windows MSI build, installer install/uninstall and upgrade validation pass; externally authorized signing and customer acceptance remain separate.
- [ ] Independent human security assessment is not yet evidenced by cross-account approvals.

## What is intentionally NOT done

This is a **safety mitigation**, not completion of Windows live networking
or customer TLS certification. A future native Windows endpoint probe needs
explicit per-invocation operator confirmation, all-answer A/AAAA validation,
pinned destination with trusted hostname-verified TLS, proxy/redirect refusal,
strict bounded JSON parser and deterministic offline negative tests. The
Linux N37 Hostinger CLI has these separate controls, but is not a substitute
for a certified Windows-probe implementation. Issue #29 **remains open** until
that complete work and real customer-approved evidence exist.

N36 PR #27 and N37 PR #28 have been merged into `main`. Original N38 #30
became conflicted and has been reconciled as main-based PR #31. User authorized
maintainer merges, which does not certify an independent human security audit. PR CI cannot certify actual physical Windows outage,
authenticated server ACK, public Hostinger DNS/TLS, external operator signing,
offsite restore, public signed MSI or live third-party integrations.

**Release decision: NOT APPROVED.**
