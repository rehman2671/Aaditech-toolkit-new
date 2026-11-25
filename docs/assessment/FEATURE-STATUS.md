# Real Feature-by-Feature Implementation Status

> **Current product evidence baseline: 2026-11-23.** For complete per-module statuses and exact latest CI runs, use [AadiTech Product Feature Acceptance Matrix](../product/FEATURE-ACCEPTANCE-MATRIX.md). Historical claims of "REAL_IMPLEMENTED" for route names or mock output were not reliable. A passing unit test or visible dashboard card is not office E2E acceptance.

| ID | Capability | Actual existing route or implementation | Correct current status and limits |
|---|---|---|---|
| FEAT-01 | Software inventory | `/api/v1/software/search`, `/api/v1/software/export`; enrolled telemetry | Code exists and automated tests; real mixed-office data acceptance pending |
| FEAT-02 | Windows/Office license compliance | `/api/v1/license/compliance`, `/api/v1/license/export` | **PARTIAL**: response contains `UNKNOWN` / `NOT_CONFIGURED`; do not claim valid keys |
| FEAT-03 | Security posture | `/api/v1/security/posture`, `security-posture.js` | Enrolled-agent reports only; unverifiable/stale fields neutral; not cloud attestation |
| FEAT-04 | Predictive analytics | `/api/v1/analytics/predictive`, `device-metrics.js` | Measured disk trend and threshold scoring; no trained AI/ML proof |
| FEAT-05 | Auto remediation | `/api/v1/remediation/policies`, `/api/v1/remediation/trigger` | **PARTIAL**: approved command queued; no proven reviewed matching repair scripts/outcome/rollback |
| FEAT-06 | Reports | `/api/v1/reports/fleet`, `/api/v1/reports/device/:id` | Code exists; exports not fully customer-accepted |
| FEAT-07 | Alerts, email, webhook | `/api/v1/alerts`, `/api/v1/alerts/email`, `/api/v1/alerts/webhook` | Backend/outbox implemented; external sending is configuration- and consent-dependent |
| FEAT-08 | Local tickets | `/api/v1/tickets` | Local records implemented; **external_sync: NOT_CONNECTED**; no actual Jira/ServiceNow/Zendesk bridge |
| FEAT-09 | M365/Azure/Intune | `/api/v1/compliance/cloud-audit` | **NOT_CONNECTED**: no Microsoft Graph transport; local posture only |
| FEAT-10 | Tenant/workspace and Windows agent | `/api/v1/workspaces`, `/api/v1/agent/enroll`; MSI diagnostic CI | Implemented/tested in isolation; offline office and signed physical MSI acceptance pending |

**Do not use** former static references `/api/v1/software/inventory`, `/api/v1/compliance/licenses` or `/api/v1/cloud/integrations` as though they were verified routes in current `server.js`. Product status is tracked separately from auto-generated `project-progress.json` historical audit closure.
