# Phase N32 — Deployment evidence report single-writer and public DNS gates

**Status: CODE PROPOSED; PR CI PENDING; CUSTOMER PRODUCTION BLOCKED (2026-11-18 IST).**

## Why

N31 accepts a redacted report path that must not overwrite an existing result. Linux
`mv -n` silently reports success when another process already created the destination;
a second preflight could therefore announce success without publishing its own evidence.
On Windows `Set-Content` can truncate a file created between an earlier existence
check and its final write. In addition, offline and live hostname validation diverged:
a dotted numeric IP string could pass the DNS-shaped regex and reserved
`example.com` documentation zones were not consistently rejected.

## N32 changes

- Stage 14 offline and live Hostinger dry-run both reject numeric final DNS labels
  (including ordinary dotted IPv4 forms) and case-insensitive reserved
  `.local`, `.test`, `.invalid`, `.example`, and `example.com/net/org` descendants.
- Stage 31 rechecks the just-read host through the live checker in **dry-run** mode
  before any optional authorized network probe.
- Stage 31 writes a mode-600 temporary JSON, atomically hard-links it to the
  not-yet-existing report path, then removes the temporary link. Collision,
  symlink target, or unsupported hard-link filesystem blocks; no overwrite or
  false success.
- Customer Windows report uses `FileMode.CreateNew` rather than `Set-Content`,
  so a concurrent writer/existing report fails closed.
- Regression tests cover reserved and numeric hosts, report symlinks,
  two concurrent Linux preflights targeting one report and immutable
  existing customer Windows reports.

## Acceptance

- [ ] PR deployment-safety tests green on GitHub-hosted Linux (including concurrent reports).
- [ ] PR PowerShell/Windows acceptance fixture green.
- [ ] PR Node/Vitest and real MySQL/API tests green (no regression).
- [ ] Review and merge only after green required checks and independent code review.
- [ ] Main branch diagnostic Windows MSI and deployment safety green.
- [ ] Real authorized Hostinger public DNS/TLS ownership and backend acceptance;
      encrypted offsite restore; genuine physical Windows replay; approved
      public signed MSI; third-party notification/Graph/ITSM remain separately pending.

**Limitations:** DNS hostname syntax does **not** prove DNS ownership or that every
resolved address is public. No real DNS lookups or HTTP probes were performed by
these new offline fixtures. Nothing in N32 authorizes deployment or closes an
external production gate.
