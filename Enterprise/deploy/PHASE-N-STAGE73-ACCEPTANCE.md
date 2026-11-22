# Phase N Stage 73 — signed source must equal live protected main SHA

## Production gap

The publisher already verified that a downloaded signed artifact came from an independently approved manual CI run and that the publisher workflow itself was dispatched on the currently protected `main` SHA. **But it did not require those two different commits to be identical.** A signed artifact from an older commit could potentially be published after main had advanced, even if its own original approval had been valid. A reviewer-signed approval for an old source is not proof that it matches current release code.

## Fail-closed fix

- Reject publication if the manual CI run's `head_sha` differs from `GITHUB_SHA` of the publisher workflow, in addition to its existing independent human-approved SHA match.
- Recheck `SOURCE_SHA == GITHUB_SHA` immediately before creating a GitHub Release draft and again **after** N70's last live protected-main check immediately before changing the release from draft to public.
- Executable N73 YAML structural tests guard approval inputs, source CI event/repository, exact-source SHA binding, production environment, pre-draft identity check and pre-publication identity check.
- If main advances between the approved signed CI build and publication, the publisher must **fail closed**. Operators must create a new human-approved signed CI run from the new current main; never retry with an old artifact and never bypass N70.

## Verification and external acceptance

- [ ] Latest N73 draft integration CI Windows/Node/API/real unsigned Windows MSI 4/4 successful.
- [ ] Latest N73 deployment-safety 2/2 successful, including real isolated MySQL backup/restore.
- [ ] Protected main branch ruleset, PR #63 prerequisite merge and independent reviews on #59/#60/#61 per issue #62.
- [ ] Real protected, separately approved, timestamped publisher-certificate signed MSI and hosted asset verification.
- [ ] Hostinger production deployment and physical Windows customer acceptance under approved credentials and change controls.

No private signing key, production Hostinger credentials, or real GitHub Release has been used in N73.
