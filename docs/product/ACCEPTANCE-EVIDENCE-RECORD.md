# Acceptance evidence record template

**This is a blank template, not a completed test.** Create one record per exact test ID (AT-LAN, AT-SEC, AT-OPS, AT-OR or AT-TR). Do not publish secrets, employee PII, key material or confidential network metadata in repository issues.

| Field | Required evidence |
|---|---|
| Test ID / requirement IDs | e.g. `AT-LAN-03` / `PR-001, PR-005` |
| Git commit and signed artifact digest | Exact full commit SHA, package version, SHA-256, signer/certificate provenance |
| Environment identity | Installation ID (redacted/hash), tenant test namespace, supported OS/build, machine physical/VM |
| Network mode | Offline LAN / VPN / public, actual WAN disconnected proof and local DNS/PKI trust method |
| Prerequisite witness | Operator who executed preflight and verified host state before any changes |
| Procedure | Reproducible exact safe steps, inputs, versioned test scripts, no secrets |
| Expected outcomes | Explicit success condition and independently checked postcondition |
| Actual outcomes | Timestamped observed output; command-ACK alone is not repair proof |
| Negative tests | Untrusted certificate, wrong tenant, interruption, missing secrets, approval denied, retry/dedup |
| Privacy/sanitization | How identities, file paths, IPs, keys and logs were minimized/redacted |
| Restore/rollback | Proof that interrupted install and irreversible actions fail safely |
| Reviewer | Authorized independent witness, date, review link |
| Gate status | `PENDING` / `PASS` / `FAIL` / `BLOCKED`; never assume from a checkmark |
| Remaining risks | Known gaps, critical dependencies, next test or approval |

## Example interpretation (not fabricated evidence)

- `ci_verdict=success` with a disposable Windows runner is **CI_VERIFIED** only.
- `agent_command.status=completed` means the agent reports execution complete; repair only **VERIFIED_RESOLVED** after an independent postcondition and required consent/user validation.
- A restore rehearsal using disposable MySQL 8 volumes is not a customer's approved off-host encrypted backup restore.
- A deployment using public DNS/ACME is not validation of internal certificate trust on a disconnected LAN.

If a necessary environmental dependency is unavailable, mark **BLOCKED** with reason and owner instead of inventing a certificate, test run or operator signature.
