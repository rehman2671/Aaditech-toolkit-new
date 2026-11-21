# Phase N Stage 70 — mandatory live main protection before production signing

**Status: CODE PUSHED FOR HUMAN REVIEW; N70 CI/LIVE SIGNING PENDING; CUSTOMER PRODUCTION NOT APPROVED.**

## Security gap

N69 validates proposed review and CI governance but does not itself gate a real manual production signing run. Main was observed unprotected and with zero active rulesets, so an actual publisher must independently refuse to use its PFX/private signer even if secrets are accidentally present.

## Implementation

- Add read-only Node.js `scripts/check-phase-n70-live-main-protection.cjs --live`, requiring exact manually dispatched main GitHub Actions context, repository and GITHUB_SHA identity, live protected main tip and active rulesets without bypass, force-push/deletion prevention, independent non-stale reviewer approval configuration and all five required GitHub Actions App 15368 CI/deployment-safety contexts.
- On GitHub API errors, malformed metadata, stale HEAD, missing token or unprotected main: block. No opt-out flag, stale local cache or synthetic CI evidence is accepted in production.
- The manual-main Windows build checks live governance before approved compiler steps and again before MSI sign. The real `Release-Sign.ps1` independently checks it before decoding PFX bytes for PrePackage and Finalize. Diagnostic push and N68 PR unsigned builds remain unchanged.
- The protected publication workflow checks immediately after first checkout and again after private draft attestation, immediately before `gh release edit --draft=false`; workflow structural tests deny removal or movement of any preflight step.
- Offline N70 negative cases cover missing main protection, changed SHA, bypass actors, disabled rulesets, weak review and forged/omitted CI status providers. These tests are registered in npm lint.
- N70 regression fix: validate the *nonsecret thumbprint format* before live API admission so malformed-fingerprint tests preserve their specific rejection; add a real PowerShell negative case proving a well-shaped thumbprint still cannot sign when GH_TOKEN/live governance is unavailable. Neither local check can decode a PFX or authorize production.

## Acceptance gates

- [x] Isolated local Node test vectors for live-governance decision engine: 5/5 passed (no GitHub network, no signing).
- [ ] Fresh combined N70 Windows/Node/API CI and isolated MySQL safety successful.
- [ ] Independent reviewer approval on PR #59, #60 and current integration draft #61, main protection/ruleset activation by administrator: see issue #62.
- [ ] After approved merger, protected main real MSI build, actual independent N63/N56 approvals and authentic publisher-signed release and hosted asset verification.
- [ ] Hostinger DNS/TLS/backend, physical Windows enrollment, customer backup/restore and customer sign-off.

**N70 preflight is expected to BLOCK against today's unprotected main; an offline passing test is not live approval. No signed artifact was produced or published.**
