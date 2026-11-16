# Phase N Stage 11 — MSI tenant isolation and release authorization

**State:** Security hardening under CI verification; NOT production certified.

## Delivered code changes

- Named MSI package downloads require authenticated tenant super-admin
  authorization. The legacy public named download route is closed.
- MSI inventory is strictly scoped by the requesting user's tenant ID.
  Selective database projection and API serialization omit historical
  plaintext bootstrap credentials, token digests and host filesystem paths.
- Newly generated bootstrap bearer tokens are returned only once to the
  privileged creator; only their SHA-256 digests are persisted.
- MSI generation no longer calls GitHub workflow_dispatch through arbitrary
  stored branding tokens or the general API_TOKEN. Signing and release
  publication stay isolated in the manual GitHub Actions approval process.
- Package names, versions and group identifiers are validated before being
  interpolated into filenames and artifact paths. Unbounded expiry and
  client-supplied tenant override fields are rejected.
- Agent setup origin is being hardened to use the real operator-owned
  production SERVER_HOST and HTTPS, not request Host/X-Forwarded-Proto.

## Verification and pending items

Run the Node/Vitest and API/MySQL CI integration suites, followed by Windows
MSI build. Security changes alter previous unit expectations of anonymous
named downloads and plaintext bootstrap persistence; these tests must use
an authenticated tenant and a valid SHA-256 one-use token.

Stage 10 baseline was green at:
https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43888103896

Do not approve production until latest Stage 11 CI is fully green; signing
certificate/environment review, live Hostinger VPS acceptance and real
Windows device enrollment remain external operator-controlled blockers.
