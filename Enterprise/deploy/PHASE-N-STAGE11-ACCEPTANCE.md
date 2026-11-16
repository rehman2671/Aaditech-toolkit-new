# Phase N Stage 11 — MSI tenant isolation and release authorization

**State:** All four Stage 11 CI jobs passed in #43903827797; NOT production certified.

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
- Generated agent JSON, install CMD/PS1 scripts and ZIP bundle now use the
  operator-configured production SERVER_HOST and HTTPS, never incoming Host
  or X-Forwarded-Proto. An absent/invalid production hostname fails closed
  (HTTP 503). The MSI itself remains independent of the server URL.

## Verification evidence and remaining gates

Stage 10 baseline: https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43888103896

Stage 11 code repair commits:
- Bootstrap SHA-256 one-use regression: 518968e0efe71b8acd9cca897fb6dc6eec13a0e3
- Trusted agent origin wired into server: 8f951b17887161b071f9064e4baca9c7b8385a5f

Latest four-job CI:
https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/43903827797

All four jobs in that exact CI run completed SUCCESS: Node/Vitest
unit+coverage, PowerShell validation, isolated MySQL 8 / API integration
(including MSI package generation, authorization and streaming), and
Windows EXE/MSI packaging with install/uninstall and major-upgrade
rehearsals. The job produced no approved trusted public signed release.
Green disposable CI is not live Hostinger or physical Windows acceptance.

Negative-path unit tests cover missing tenant scopes, withheld plaintext
bootstrap tokens, untrusted host/forwarded headers, invalid package
filenames, cross-tenant package query parameters and an explicitly missing
production hostname.

Historical rows may still hold legacy plaintext MSI bootstrap tokens;
new writes intentionally store only token hashes. Operator must review
legacy credential invalidation and old-row cleanup in a controlled
production migration, not simply delete credentials used by active devices.

**Production release: BLOCKED.** Do not distribute the diagnostic unsigned
MSI. Human-reviewed code signing/environment settings, trusted published
release, actual Hostinger VPS with real DNS/public HTTPS, production database
migration/recovery and physical Windows UAC/setup/upgrade acceptance
still need operator-owned evidence.
