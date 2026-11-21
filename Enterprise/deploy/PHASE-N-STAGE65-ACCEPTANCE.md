# Phase N Stage 65 — immutable GitHub Actions dependency identity

**Status: PR CI 3/3 + DEPLOYMENT SAFETY 2/2 SUCCESS; INDEPENDENT SECURITY REVIEW AND POST-MERGE MAIN MSI PENDING; CUSTOMER PRODUCTION NOT APPROVED (2026-11-21 IST).**

## Finding

The current N64 baseline still references moving GitHub Actions major-version tags in workflows responsible for checkout, Node initialization, uploading signed artifacts, and downloading protected release assets. These tags could change without a corresponding Aaditech source change. N63 compiler archive checks do not bind these Actions.

## Scope

- Pinned all four external GitHub Actions in all four workflows to exact 40-character official commit SHAs, sourced from the `actions/*` GitHub `refs/tags/v4` API at implementation time.
- New `scripts/check-github-actions-pins.cjs` parses all workflow YAML structures (not only line patterns), rejects unrecognized actions, moving tags, changed hashes, quoted/inline `uses:` bypasses, aliases, duplicate YAML keys and linked workflow files.
- New native Node unit tests exercise accepted pins and negative cases, including valid YAML quoted/inline actions, duplicate keys, anchors and GitHub expressions. The checks run within `npm run lint` in both Node/MySQL CI jobs.
- No production signing secrets, compiler approval hashes or customer data were changed or synthesized.

## Reviewed SHA candidates

| GitHub Action | Exact commit |
| --- | --- |
| `actions/checkout` | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `actions/download-artifact` | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |

These references reduce tag drift but do not certify upstream code security, provenance, publisher signing or independent human review. Changes to Actions require a reviewed SHA allowlist update.

## Verified PR evidence

- [PR #60](https://github.com/rehman2671/Aaditech-toolkit-new/pull/60) reviewed-code candidate `3dc410dc3dee6eea1b44026d8b2fd655e92091c9`.
- [PR CI 44884573166](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44884573166) **3/3 SUCCESS**: Node/Vitest+MySQL (including strict YAML validator and malicious quoted/inline/alias action references), PowerShell security validation and API/MySQL integration. PR MSI packaging correctly skipped.
- [PR deployment safety 44884573084](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44884573084) **2/2 SUCCESS**: offline recovery and isolated real MySQL restore verification.
- The earlier [initial PR CI 44830175678](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44830175678) **FAILED** on a regression-test error-message mismatch; this was fixed and revalidated. No failure is being hidden by the acceptance record.

## Acceptance

- [x] PR Node/Windows/API-MySQL/security-safety checks passed at code commit above.
- [ ] Independent human security review and reviewed merge.
- [ ] Post-merge main Windows EXE/MSI extraction, install, clean uninstall and preserved-configuration upgrade pass.
- [ ] Independently approved real N63 compiler archive SHA pins, N56 signed release authorization, publisher certificate/HSM, remote draft/public asset attestation, Hostinger DNS/TLS and physical Windows enrollment **PENDING**.

**Customer production NOT APPROVED.**
