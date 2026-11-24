# FE-38 — Cloud/security status rendering acceptance contract

**Status:** IMPLEMENTED; prior exact integration runtime rendering regressions CI-verified. New coverage-denominator and contradictory-evidence refinements pending fresh CI and independent review.  
**P0 issue:** [#78](https://github.com/rehman2671/Aaditech-toolkit-new/issues/78)  
**Required release test:** `AT-SEC-05`. **Independent of DEC-001 backend stack choice.**  
**Source baseline:** `main` commit `911f509620029c513305c88b26ca0da4e1b7da37`.

## Observed contract, not guesswork

Backend `server.js` `GET /api/v1/compliance/cloud-audit` explicitly returns `status: "NOT_CONNECTED"`, `configured: false` and `cloud_services: []` because no real Microsoft Graph/OAuth integration exists. Each `agent_compliance[]` row has `azure_ad_joined: null` and `intune_managed: null`, while `bitlocker_encrypted`, `defender_realtime_on`, `evidence_status`, `posture_reported_at` and `compliance_status` come from `normalizeAgentPosture` (`security-posture.js`). 

`normalizeAgentPosture` labels telemetry `AGENT_REPORTED` only for valid observations no more than 24 hours old; missing reports become `UNVERIFIED`; old/future timestamps become `STALE`. Unknown, partial or stale data must never be promoted to compliant.

The historical baseline dashboard `renderIntegrations` in `Enterprise/portal/index.html`, around lines 1989–2120, **ignores these fields** for four green table badges and applies `tone: "ok"` even when summary values are `Not connected` or `N/A`. It also paints `ac.compliance_status` as green even when it says `Not verified` or `Agent-reported noncompliant`. That is a real UI-state defect.

## Required field-to-UI mapping

| Field | Observed evidence | Permitted UI | Prohibited UI |
|---|---|---|---|
| `cloud.status`, `cloud.configured` | `NOT_CONNECTED` / `false` | Neutral **Not connected** across summary and services; explain no Graph/Intune attestation | Green `Azure sync healthy`, invented sync timestamp or latency |
| `ac.azure_ad_joined` | `null` without cloud integration | **Not connected / Unknown** (neutral) | Green **Active** or `false` default interpreted as verified |
| `ac.intune_managed` | `null` without cloud integration | **Not connected / Unknown** (neutral) | Green **Enrolled** or `false` assumed from missing source |
| `ac.bitlocker_encrypted` | `null` | **Not verified** (neutral) | Green **Encrypted** |
| `ac.bitlocker_encrypted` | `true` + `AGENT_REPORTED` | **Protected (agent-reported)** positive local observation | Cloud-attested or cryptographically certified claim |
| `ac.bitlocker_encrypted` | `false` + `AGENT_REPORTED` | **Not protected (agent-reported)** warning/negative | Green encrypted |
| `ac.defender_realtime_on` | `null` | **Not verified** (neutral) | Green **Active** |
| `ac.defender_realtime_on` | `true` or `false` + `AGENT_REPORTED` | **Active** or **Inactive**, explicitly *agent-reported* | Independent MDM/Defender cloud attestation |
| `ac.evidence_status` | `UNVERIFIED` / `STALE` | Neutral **Not verified** / **Stale**; optionally display safe last report time | Any green positive based on old, absent or future observation |
| `ac.compliance_status` | `Not verified` | Neutral Not verified | `badge ok` |
| `ac.compliance_status` | `Agent-reported noncompliant` | Warning/negative, with reported evidence | `badge ok` |
| `ac.compliance_status` | `Agent-reported compliant` + fresh and complete | Qualified **Agent-reported compliant** positive | Blanket overall enterprise compliance proof |
| `cloud.summary.*` | `Not connected` / `N/A` | Neutral cards, do not infer score | Forced `ok` tone or invented percent |
| `cloud.cloud_services` | Empty array | Explicit empty-state **No cloud connector is connected** | Fake connected rows or "Continuous" sync |
| Service `last_sync`, `latency_ms` | Missing/null | **N/A** | `Continuous`, `null ms`, `undefined ms` |

**Rule:** for local device security, `true` and `false` are usable only when source is sufficiently fresh and `evidence_status === "AGENT_REPORTED"`; `null` is **unknown**, not false or green. Real future cloud statuses must be sourced from independently implemented connector evidence rather than simply accepting an agent claim.

## Implementation boundary

- Preserve the existing tenant authorization and API contract. Change the DOM/template status mapping, badge tone, summary tone and empty state in a reviewed code PR. If helpers are introduced, they must be pure/testable and not duplicate backend claims.
- Use existing output escaping for hostnames/provider text and sanitize any new field displayed. Never insert user-controlled HTML in status messages.
- Provide visible words and meaningful labels as well as status colors; do not rely on green/red alone.
- Do not call out to Microsoft or set cloud connection values just to satisfy a unit test; a disconnected connector is an expected valid state.

## Automated acceptance cases (historical requirements; existing rendering suite passed on deb6a098)

1. **Null cloud**: `cloud.status=NOT_CONNECTED`, `azure_ad_joined=null`, `intune_managed=null` -> visible neutral Not connected, no green Active/Enrolled.
2. **Unverified endpoint**: no `posture_reported_at`, `bitlocker_encrypted=null`, `defender_realtime_on=null` -> neutral, `Not verified` status.
3. **Stale endpoint**: `evidence_status=STALE` even with inherited booleans -> no green; recent/backend-approved field consistency required.
4. **Fresh healthy**: true BitLocker/Defender with `AGENT_REPORTED` -> green permitted *only* with source qualifier (not cloud attestation).
5. **Fresh unhealthy**: false encryption or Defender and `Agent-reported noncompliant` -> negative/warning, never green.
6. **Incomplete but fresh**: one field null => field neutral; overall Not verified even if others report true.
7. **Summary and connector empty-state**: Not connected/N/A cards neutral; empty service list clearly states disconnected; missing last_sync/latency is N/A.
8. **Tenant isolation and XSS**: malicious hostname/provider string escaped; another tenant's device never appears.
9. **Status accessibility**: semantic text remains comprehensible without color.
10. **Regressions**: existing `tests/unit/security-posture-stage24.test.js` stays passing, but add *actual dashboard-rendering* coverage; only backend unit tests are insufficient.

## Go / no-go

`FE-38` is **CI_VERIFIED** for the prior exact revision, with independent reviewer and fresh combined CI still required. The historical AT-SEC-05 label overlaps the distinct command-result recovery tracker; do not treat this dashboard fix as closure of command-result acceptance. See exact-head evidence below.

## Phase O parallel endpoint, dashboard and recovery review hardening (2026-11-25 IST)

Exact integration deb6a0981fa7cfd6693f76ca1b21bf1fe8067de1: CI 45460379289 Node/Vitest, PowerShell, API/MySQL completed successfully, unsigned MSI running at observation; protected signing skipped. Safety 45460379259 both jobs passed. Existing FE-38 actual portal rendering tests and combined integration tests executed in passing Node job 138681188625; former DESIGN ONLY/NOT_STARTED tracking was stale.

Parallel security batch: installed PowerShell verifier requires canonical 56-character per-device token, typed outer command ID/signature/content, object JSON envelope, integral version, nonblank typed identity/kind, object payload and bounded parsed issue/expiry clock; rejects MAC-valid coercible values. Native fixture corrected from a 55-character token, expanded regressions and added Windows PowerShell 5.1 CI alongside pwsh. Allowlisted script dispatcher requires scalar script name, separator-bounded canonical root and rejects root/descendant reparse points; isolated harmless CI script and junction regression. Local ACL integrity and concurrent path replacement remain separate physical acceptance gates. FE-38 portal now shows measured BitLocker denominator against fleet and treats fresh negative security field as noncompliance even with contradictory overall label; rendering regression extended. Review-only authorization input now requires exact-length typed tenant/device/request IDs and hashes, rejecting coercible or newline-tailed pins before transaction. No live activation grant or endpoint proof. Fresh combined CI required.

Keep FE-38 blocked for independent review and production acceptance despite existing runtime/CI evidence; historical AT-SEC-05 identifier is also used for command-result recovery, so do not overwrite that distinct tracking row. No owner ADR, credential issuance, protected signing, main merge or physical acceptance. Remaining: independent evidence custody, durable activation authority, endpoint local handoff, real application usage collection and encrypted staging migration rehearsal.
