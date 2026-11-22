# Phase N Stage 74 — enforce Windows security check before protected signing

## Release sequencing finding
The protected agent-build CI job previously depended on Node/Vitest and API/MySQL jobs but not PowerShell validation. It could start a manual signed build while PowerShell security tests were still running or failing. Publication already requires a successful whole source CI run, but that is too late to prevent early signing.

## Implementation
- Add powershell-validation to the existing agent-build.needs list alongside node-tests and api-tests.
- Keep the protected production-installer environment, manual main-only signer event, and live N70 governance preflight unchanged.
- Add an executable N74 YAML gate and negative tests to npm run lint to detect missing or duplicated dependencies, conditional/optional security checks and weakened signing admission.

## Acceptance
- [ ] Latest integration CI: Windows, Node/Vitest/MySQL, API/MySQL and real unsigned Windows MSI installer/major upgrade successful.
- [ ] Latest deployment safety two Linux/MySQL jobs successful.
- [ ] GitHub protected main ruleset and authorized independent security reviews for prerequisite PR #63 and PRs #59/#60/#61 are complete as described in issue #62.
- [ ] Real production signer and hosted signed-release publication validated only after authorized reviewed main merge.

This is preventive fail-closed sequencing hardening, not a signed release or Hostinger acceptance.
