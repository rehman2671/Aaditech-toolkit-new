# Phase N Stage 67 — Strict unprovisioned signed installer configuration admission

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; MAIN CI 3 JOBS SUCCESS, DIAGNOSTIC MSI IN PROGRESS; CUSTOMER PRODUCTION NOT APPROVED (2026-11-22 IST).**

## Concrete gap

Prior final publication verification (N55) only checked `needs_setup` and the four known endpoint/token strings were empty. It could accept an EXE/MSI upload containing an additional credential field (for example `client_secret`), a nonempty `run_script_allowlist`, changed feature script path, or malformed JSON with duplicate credential properties, despite those bytes being signed. The MSI is intended to be fully generic and configured by the user **after installation**, without any Hostinger server credentials baked into it.

## Implemented N67 gate

1. `Enterprise/agent/build/ReleaseConfigAdmission.psm1` requires PowerShell 7 and parses JSON with `System.Text.Json.JsonDocument` to retain and reject **duplicate keys** (rather than allowing a lossy last-key-wins parse). It rejects unknown/missing/mis-cased fields, wrong JSON types, oversized payloads, reparse files, nonblank endpoint/enrollment/token/bootstrap values, nonempty script allowlists, incorrect `needs_setup`, and version/interval discrepancies.
2. For every feature, it compares exact name, approved script path, enablement default, elevation requirement and order against the independently checked-in `Enterprise/agent/features.json` source manifest; extra nested properties, feature removal, script substitution and unsafe manifest paths are blocked.
3. `Verify-SignedPublication.ps1` retains the N55 checks, then applies N67 to the **external** `agent-config.json` and **every** `agent.json` extracted from the signed MSI **before** `PUBLICATION_VERIFIED=true`. The protected signer, Authenticode and independent release-approval gates are unchanged.
4. Main/diagnostic MSI CI now checks the newly generated generic agent JSON before any compiler installation or packaging. Offline PowerShell 7 tests exercise baseline acceptance and negative token/endpoint additions, schema/typed-value mutations, extra or duplicate fields, feature substitutions, nonempty allowlists and final-gate ordering. There is no public signing/publishing fallback.

## Acceptance evidence and production boundary

- [x] [PR #67](https://github.com/rehman2671/Aaditech-toolkit-new/pull/67) merged as `462b41b9b000b299ad5458fbd3ec155e98809cf7`; no separate human release approval implied.
- [x] [PR CI #45050758426](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45050758426) **3/3 SUCCESS** (PowerShell 7 synthetic N67 negative tests PASS, Node/Vitest+MySQL and API/MySQL); [PR safety #45050758376](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45050758376) **2/2 SUCCESS**.
- [x] [Fresh merged-main CI #45051039313](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45051039313) has passed N67's **real pre-compiler generic JSON validation**, PowerShell, Node/MySQL and API/MySQL jobs. [Main deployment safety #45051039322](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45051039322) **2/2 SUCCESS**.
- [ ] Main Windows diagnostic EXE/MSI build, administrative extraction, setup/uninstall/major upgrade job: **IN PROGRESS**, not accepted yet.
- [ ] Protected manual main run with *independently* approved exact compiler NUPKG, SQLite ZIP and EXE, reviewer signature, publisher certificate/HSM, signed release publication, real Hostinger VPS/domain, physical Windows device and offsite MySQL restore evidence: **PENDING**.

**Scope:** N67 is generic signed-installer configuration admission, not proof that future local post-install customer configuration is correct. It does not require any real Hostinger URL or tenant token. **Production release NOT APPROVED.**
