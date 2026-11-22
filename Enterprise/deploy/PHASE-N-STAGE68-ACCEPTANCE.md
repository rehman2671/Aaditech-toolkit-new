# Phase N Stage 68 — Real VPS deployment requires authoritative pinned HTTPS, structured MySQL and redirect acceptance

**Status: MERGED; PR CI 3/3 + SAFETY 2/2 SUCCESS; MAIN CI 4/4 + SAFETY 2/2 SUCCESS; REAL HOSTINGER/CUSTOMER PRODUCTION NOT APPROVED (2026-11-23 IST).**

## Failure mode fixed

The supported Node/MySQL `Enterprise/deploy/deploy-mysql.sh` deployer previously accepted deployment when an arbitrary text/JSON response happened to contain `"database":"HEALTHY"`. That simple `grep` admitted a forged top-level or nested string, duplicate JSON fields, or an unhealthy actual `components.database`. It also called ambient curl without pinning all DNS answers or requiring a genuine HTTP-to-HTTPS redirect. This could print success despite an unhealthy public deployment.

The pre-existing `verify-hostinger-acceptance.sh` was already substantially more defensive but was **not** required by `deploy-mysql.sh` before claiming successful deployment.

## Code changes

1. Both deployment `--dry-run` and real mode use the authoritative verifier's **offline** `--dry-run` hostname admission before creating secrets or reaching Docker. Reserved or nonpublic DNS suffixes fail, case-insensitively. When an existing `.env` is present, dry-run additionally requires the exact Stage N14 private credential/hostname preflight (including 0600 permissions, 32+ byte unique secrets and matching public DNS fields); first-time dry-run without `.env` checks DNS syntax only. No DNS, curl or remote call occurs during dry-run.
2. Before real Docker Compose validation/startup, enforce the existing private `preflight-stage14.sh` on the local `.env`; this rejects weak/reused/placeholder credentials, unsafe permissions, invalid/mismatched hostname and malformed operator identifiers, without sourcing or logging secrets. Previously initialized MySQL volume/credentials preservation is unchanged.
3. On a live deploy only, the strict verifier is mandatory for **each** bounded health retry. It verifies real publicly trusted server TLS, one-time public DNS resolution with curl route pinning, exact top-level `status=ok` and `components.database=HEALTHY` without duplicate JSON keys, and a real HTTP redirect to the same HTTPS origin. On any final failure, `deploy-mysql.sh` emits an error, never claims success, and does not weaken HTTPS or rotate database secrets. A real deployment command constitutes operator consent to the verifier's health checks after starting services.
4. Existing no-Docker dry-run fixture copies the strict verifier; new `Test-Stage68StrictVpsAcceptance.sh` exercises the **real deployer** against disposable fake Docker/verifier/sleep executables, proving that accepted probes print readiness, rejected probes do not, retry count is bounded, and existing secrets remain unchanged. Stage N37 separately tests the actual verifier against fake hostile DNS, TLS trust, redirect and malformed/degraded health responses.
5. The deployment-safety GitHub workflow now runs the new offline N68 regression.

## Evidence/limits

- [x] Code and offline mock regressions added in the N68 PR branch. No production DNS or Hostinger account was queried; no real Docker daemon or customer MySQL volume was modified.
- [x] [PR #68](https://github.com/rehman2671/Aaditech-toolkit-new/pull/68) merged at `d3ef78605d068c51ef8c8572c98f875497032e24`; PR [CI #45052878778](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45052878778) **3/3 SUCCESS**, [safety #45052878701](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45052878701) **2/2 SUCCESS**, including the actual N68 mock-Docker/verifier regression and isolated real MySQL restore rehearsal.
- [x] Merged main [CI #45054244204](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45054244204) **4/4 SUCCESS**, diagnostic Windows MSI build and install/uninstall/tenant-preserving major upgrade; [safety #45054244194](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45054244194) **2/2 SUCCESS**. No real Hostinger/customer rollout or signing performed.
- [ ] Operator-approved Hostinger Docker VPS, real DNS/ACME and live server MySQL/API/tenant, off-host restore, Windows tenant enrollment, approval/signing/publisher evidence: **PENDING**.
- [ ] Independent security owner / customer production sign-off: **NOT APPROVED**.

**Scope:** A green offline mock or CI database rehearsal is **not** a live Hostinger deployment. N68 strengthens live deployment acceptance but cannot manufacture the target server, DNS records, signing certificate or backup proof.
