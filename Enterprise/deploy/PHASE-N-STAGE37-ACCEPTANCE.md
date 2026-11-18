# Phase N Stage 37 — Pinned, Read-Only Public HTTPS Acceptance

**Status: CODE PROPOSED / PR CI PENDING / DEPENDS ON N36 / CUSTOMER PRODUCTION BLOCKED (2026-11-18 IST).**

## Why

Valid DNS *syntax* alone is insufficient for a live Hostinger acceptance check:
the name might resolve to loopback, an RFC1918 address, cloud instance metadata,
IPv6 ULA/link-local or mixed public+private answers. Separate resolver and curl
lookups can also see different answers after rebinding. A configured HTTP proxy
could bypass the intended resolution.

## N37 safety boundary

- Live acceptance requires Python 3, resolves the hostname using OS resolver
  `socket.getaddrinfo` and rejects **all** non-global/special-use A and AAAA
  answers, including mixed answer sets. This step is offline only in CI fixtures,
  and happens **only** after N31 explicit live consent and N14 DNS-shape checks.
- One public address is chosen (IPv4 preferred, IPv6 bracketed) and pinned with
  curl `--resolve HOST:443:IP` and `--resolve HOST:80:IP`.
- Both requests use `--noproxy '*'`; curl's ordinary OS certificate trust and
  hostname verification remain mandatory for HTTPS. Requests do not follow
  redirects; HTTP only inspects the intended redirect target.
- DNS errors, absence of answers, private and special-use addresses, unavailable
  Python 3, and rejected curl connections are failures. No fallback to an
  unvalidated DNS answer or automatic retry to a different endpoint.
- `--dry-run` still performs **no DNS lookup and no HTTP request**.

## Verification

- [ ] Review Python stdlib public address decisions across supported VPS Python
      versions; no network calls in unit tests.
- [ ] Deployment-safety CI passes IPv4/IPv6 private, loopback, documentation,
      metadata, transition-protocol and mixed DNS-answer negative fixtures.
- [ ] Bash mock acceptance proves both HTTPS and redirect checks use the same
      pinned public address, bypass proxies, and are never called after DNS denial.
- [ ] PR CI (PowerShell, Node/Vitest, isolated MySQL/API) passes without affecting N32–N35.
- [ ] N36 independent review/merge accepted before retargeting N37 onto main;
      then obtain independent N37 review and main CI/MSI acceptance.

## Explicit limitations

This is defense-in-depth, **not proof of Hostinger ownership**. NAT, transparent
network interception, DNSSEC validation, customer DNS change control, actual
certificate trust, Caddy configuration, database health and outside-in reachability
require separately authorized real-world evidence. IPv4/IPv6 address special-use
registries evolve, and validation may conservatively reject legitimate unusual
network deployments; it must never silently allow a private route.

No public DNS, internet endpoint, production tenant, customer Windows machine,
real key vault or signed installer was accessed to create this code.
