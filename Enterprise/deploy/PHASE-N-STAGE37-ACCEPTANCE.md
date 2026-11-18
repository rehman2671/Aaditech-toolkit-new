# Phase N Stage 37 — Pinned, Read-Only Public HTTPS Acceptance

**Status: PR CODE/CI GREEN; INDEPENDENT REVIEW AND N36 MERGE PENDING; CUSTOMER PRODUCTION BLOCKED (verified 2026-11-19 IST).**

## Independently checkable CI evidence

- [PR #28](https://github.com/rehman2671/Aaditech-toolkit-new/pull/28) currently targets the N36 integration branch; corrected **code** commit `664d701c1523737b0d59b02431310d822be7c753` (direct live consent, isolated curl trust, pinned DNS and strict health JSON).
- [PR CI #44384629009](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44384629009): **SUCCESS**. Windows PowerShell, Node/Vitest+MySQL 8 and real isolated API/MySQL 8 passed; PR-only Windows EXE/MSI diagnostic job **SKIPPED BY DESIGN**.
- [PR deployment-safety #44384629243](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44384629243): **SUCCESS 2/2**. Offline DNS/HTTP/payload/consent negative tests and isolated MySQL restore.
- N36 prerequisite [PR #27](https://github.com/rehman2671/Aaditech-toolkit-new/pull/27) passed [CI #44304775570](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44304775570) and [safety #44304775551](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44304775551), but **neither PR currently has a submitted independent approval**. Requested reviewer is `rehman2671`; no authorized merge has occurred.
- These are automated tests on disposable CI data and mocked network probes, **not** independently approved customer network/DNS/TLS evidence. New commits, retargeting or merges require fresh gate verification.

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
- Both curl calls require `-q` as their **first** command-line argument to
  ignore user curlrc configuration that could override TLS/routing options.
  Additionally, each curl subprocess clears inherited `CURL_CA_BUNDLE`,
  `SSL_CERT_FILE`, `SSL_CERT_DIR` and `CURL_SSL_BACKEND` overrides, failing
  closed if cleanup fails. This checks the system-configured CA trust store,
  **not independent proof that the certificate chains to an approved public CA**
  when the host trust store contains custom roots.
  The HTTP check accepts only 301/302/303/307/308 with an HTTPS redirect
  to the approved hostname; 200-with-Location, a cross-origin redirect or
  an error status must be rejected. Redirects are **not followed**.
- HTTPS health JSON is bounded to 64 KiB and parsed as structured JSON, with
  duplicate-key rejection and exact top-level `status="ok"` plus
  `components.database="HEALTHY"`. Ambiguous nested, malformed, degraded or
  oversized payloads are denied without logging response bodies.
- Direct live CLI invocation requires explicit `--confirm-live PROBE_PUBLIC_HEALTH`;
  the N31 wrapper forwards its own approved consent. Missing or wrong consent
  must fail **before any DNS lookup or curl**, and `--dry-run` must never
  combine with live consent. Tests enforce these cases with offline counters.
- DNS errors, absence of answers, private and special-use addresses, unavailable
  Python 3, and rejected curl connections are failures. No fallback to an
  unvalidated DNS answer or automatic retry to a different endpoint.
- `--dry-run` still performs **no DNS lookup and no HTTP request**.

## Verification

- [ ] Review Python stdlib public address decisions across supported VPS Python
      versions; no network calls in unit tests.
- [x] Deployment-safety CI passes IPv4/IPv6 private, loopback, documentation,
      metadata, transition-protocol and mixed DNS-answer negative fixtures.
- [x] Bash mock acceptance proves both HTTPS and redirect checks use the same
      pinned public address, bypass proxies, and are never called after DNS denial.
- [x] Direct checker and N31 wrapper require explicit approved live consent;
      missing/invalid consent and conflicting dry-run+live arguments fail
      before a DNS resolver or curl subprocess runs.
- [x] Mocked curl checks enforce `-q` first, no HTTP redirect following,
      and actual 301/302/303/307/308 status; synthetic 200-with-Location and
      cross-origin/private redirect targets must fail closed.
- [x] Positive mock probes poison all four caller CA/SSL-backend environment
      variables and verify neither HTTPS nor HTTP curl sees them.
- [ ] Independently verify customer-approved public CA chain and host trust-store provenance.
- [x] Python and mocked HTTP tests reject duplicate, malformed, oversized,
      nested and degraded health JSON even when misleading outer fields say HEALTHY.
- [x] PR CI (PowerShell, Node/Vitest, isolated MySQL/API) passes without affecting N32–N35.
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
