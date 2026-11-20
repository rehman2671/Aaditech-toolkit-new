# Phase N Stage 44 — Fail-Closed Offline Windows Diagnostic Evidence Audit

**Status: MERGED; MAIN CI/MSI 4/4 AND DEPLOYMENT-SAFETY 2/2 GREEN; CUSTOMER PRODUCTION NOT APPROVED (2026-11-20 IST).**

## Why

The operator's N42/N43 `https_health_probe=PASS` is an **unsigned local
observation of one HTTP health check**, never externally witnessed release
approval. No system should interpret the JSON field as evidence that the
publisher-signed MSI, offsite restore, independent security review or real
customer Windows lost-ACK replay passed.

`Enterprise/deploy/audit-windows-health-evidence.py` is a **strictly
offline / read-only** evidence format auditor. It accepts a N42/N43 redacted
diagnostic report as an input **regular file** on a platform providing
`O_NOFOLLOW` (Linux CI), rejects unsafe/missing/symlinked/hard-linked or
oversized files, uses bounded read checks, strict UTF-8 and duplicate-key
JSON validation, exact schema fields/types and a UTC timestamp.
It rejects logically impossible claims (offline `PASS`, uncertified evidence
asserting `certified_for_production=true`, or external gate flags other than
`PENDING`). It makes **no DNS, HTTP, API, production database, credential or
signed-artifact request**.

Even when the input is syntactically valid and self-reports `PASS`, the
auditor only emits `production_approved:false`, a fixed list of external
release gaps, and **exits 3**. Invalid evidence exits **1** with a generic
message and no parsed report output. The auditor **cannot** return a
production-approved verdict or validate third-party signatures. The exit
codes are intended for fail-closed release pipelines.

## Offline usage

Copy a separately generated, redacted N42/N43 diagnostic report to a
controlled Linux workstation, then:

```bash
python3 Enterprise/deploy/audit-windows-health-evidence.py \
  --report ./redacted-windows-health.json \
  --output ./release-evidence-audit.json
```

The `--output` path **must not already exist**: the audit creates it with
exclusive mode-0600 semantics, never overwrites prior evidence or echoes
customer configuration. An exit status of `3` with valid audit JSON means
**NOT APPROVED**. Do not treat a successfully parsed report as a signed,
fresh, externally verified or production-authorized attestation. An exit
status of `1` means malformed or unsafe input.

## Acceptance

- [x] N44 Python regression rejects malformed, duplicate-key, BOM,
  oversized, invalid UTF-8, symlinked, wrong-schema and self-certified input.
- [x] Valid live `PASS`, live `BLOCKED`, offline `PENDING` all return
  a machine-readable, redacted `production_approved=false`, with exit 3.
- [x] Audit output is 0600, exclusive and nonoverwriting; no user paths,
  endpoints, tokens, tenant identifiers or customer body content logged.
- [x] PR PowerShell, Node/Vitest, isolated API/MySQL and deployment safety
  green; PR #39 merged. Main Windows MSI CI independently verified.
- [ ] Independently approved customer Hostinger DNS/TLS, physical Windows
  ACK replay, publisher-signed MSI, HSM/KMS custody, offsite restore,
  actual integrations and human security audit completed *outside* CI.

N43 separately consented pinned Windows operator diagnostic exists and
the unsafe N31 `-NetworkProbe` stays disabled. N44 does **not** enable any
endpoint execution or grant production authorization.

**Production: NOT APPROVED.** [Issue #29](https://github.com/rehman2671/Aaditech-toolkit-new/issues/29)
remains open for customer-side external evidence.

## Verified N44 CI and merge (not release approval)

- [PR #39](https://github.com/rehman2671/Aaditech-toolkit-new/pull/39) merged to `main` as `004ad08ca02eef0e1503ba1a22f36a01668b2d18`.
- [Main CI #44649979210](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44649979210) **4/4 SUCCESS**, including actual Windows diagnostic EXE/MSI build, Windows Installer extraction, fresh install/uninstall and major upgrade rehearsals.
- [Main deployment safety #44649979330](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/44649979330) **2/2 SUCCESS**, including N44 fail-closed audit fixtures and isolated MySQL backup/restore checks.
- No publicly signed MSI upload, independently witnessed customer Windows TLS or lost-ACK, verified Hostinger origin/chain, offsite restore or human release approval was provided. This auditor **only checks report format**; it cannot authenticate authorship or certify production.
