# MSI release admission: default deny outside automated tests

**Proposal: code/security fix, independent reviewer and exact-head CI required. Production signing is not approved.**

`agent-artifacts.js::matchesApprovedReleaseHash` is used by `resolveAgentMsi` and every supported MSI download path (public latest aliases and tenant-admin package links), plus production rollout admission.

Previously the helper returned `true` whenever `NODE_ENV` was **not** exactly `production`. In a real staging server, Windows desktop/local deployment or accidentally unconfigured `NODE_ENV` process, this skipped the size and SHA-256 allowlist entirely and could expose diagnostic fixture/unsigned MSI artifacts on public download aliases.

This hardening changes the bypass to **only** `NODE_ENV=test` for existing automated test fixtures. In any other environment, a valid 64-digit `APPROVED_MSI_SHA256`, an on-disk regular file at least 16 KiB and exact hashed bytes must match or the resolver fails closed and the named route returns `MSI_RELEASE_NOT_APPROVED`. `NODE_ENV` unset, `development`, `staging`, and case-mismatched `Production` all require the approved hash. These are deliberate restrictive changes for local development/preview; an unsigned MSI must not be offered as deployable.

**Security boundary:** checksum approval alone does **not** authenticate the publisher or certify Authenticode signing. Independent production release policies, signing certificate/HSM, GitHub enforced no-bypass ruleset and human reviewed source digest still apply. Never use `NODE_ENV=test` for an exposed deployment, and do not supply fabricated approval pins. This PR does not provide a signed installer, office LAN install or recovery proof.

Tests: `tests/unit/msi-production-approval.test.js` includes missing/mismatched/exact hash scenarios with `NODE_ENV` absent/development/staging, preserving the explicit test-fixture allowance.
