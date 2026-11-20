# Phase N Stage 53 — Pin exact signed Windows HTTPS approval for one diagnostic

**Status: CODE PROPOSED; CI AND REVIEW PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Finding

N52 reverified the reviewer RSA signature, expiry, origin and both curl hashes
at four execution boundaries. However, a *different* canonical manifest
signed by the same approved reviewer key for the same destination and curl
digests could replace the initial manifest between these checks. It would
still satisfy N51/N52 even though the diagnostic's originally approved
change record (`approval_id`) had changed.

This is a *session continuity* concern, **not** a claim that N52 ever accepted
an unsigned or expired record.

## Code change

`Enterprise/deploy/WindowsCurlSignedApproval.psm1` now optionally:

- returns the SHA-256 of the **exact ASCII-LF manifest bytes** only after
  reviewer certificate pinning, signature and expiry verification succeed
  (`-ReturnManifestSha256`);
- requires a previously authenticated digest on subsequent validations
  (`-ExpectedManifestSha256`), checked using a 32-byte accumulation of
  XOR differences, with strict 64-hex input, after authenticating the
  supplied record;
- preserves the original `$true` result for existing N51/N52 callers,
  so no existing operator or offline tests need a new parameter.

`Enterprise/deploy/Test-WindowsPinnedPublicHttps.ps1` captures only the
initially verified digest **in memory** and supplies it to the **pre-DNS,
pre-transfer and post-transfer** N52 checks. An authentic and unexpired
replacement approval (including a distinct `approval_id`) is rejected
as `BLOCKED` until a new, independently authorized diagnostic invocation.
No signed payload, fingerprint, hostname, operator approval or key material
is copied into the redacted acceptance report.

The initial 24-hour expiry rule, per-invocation operator consent, N49/N50
independent curl pins, pinned public IP and the N31 unattended-network block
remain intact.

## Offline verification

`Enterprise/tests/Test-Stage53WindowsApprovalContinuity.ps1` creates
throwaway RSA-2048 reviewer signing material on a temporary local Windows
directory and verifies:

1. An authentic signed manifest returns the exact SHA-256 of its canonical
   source bytes.
2. Both upper/lower case representations of the same SHA are accepted; a
   blank, malformed or wrong initial manifest hash fails with a redacted error.
3. A **separately RSA-signed and otherwise fully valid** manifest with the
   same reviewer, hostname and curl hashes but a different approval ID
   passes N51 validation but is **blocked by N53 continuity**.
4. Restoring the exact original manifest and signature restores acceptance;
   an otherwise authentically signed **expired** approval still fails.
5. The operator script actually captures one original record and reuses
   that digest at all three later checkpoints in the expected order.

CI runs this test in Windows PowerShell 5.1 and PowerShell 7 with N31–N52
tests, Node/Vitest+MySQL, API/MySQL and deployment safety.

## Limitations

This is a non-persistent **single-invocation record-continuity gate**, not
an online revocation database. A reviewer can independently authorize a
**new** probe with a different signed record. Local administrator
compromise, reviewer-key compromise and clock rollback require separate
controls. It does not cancel an HTTPS GET already in flight, nor establish
customer hostname ownership or real HSM publisher signing.

## Acceptance

- [ ] PR Windows PS5.1/7 N53+N31–N52 regression, Node/Vitest+MySQL,
  API/MySQL and deployment-safety workflows green.
- [ ] Reviewed PR merged at verified head and fresh main Windows EXE/MSI
  lifecycle **4/4** plus safety **2/2** independently confirmed.
- [ ] Production gates: approved reviewer public-key custody and signed
  customer record, genuine Hostinger DNS/TLS, publisher/HSM-signed MSI,
  physical lost-ACK and MySQL queue receipts, offsite restore and external
  integration/security owner approval **PENDING**.

**Production NOT APPROVED.**
Security tracker: [issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29).
