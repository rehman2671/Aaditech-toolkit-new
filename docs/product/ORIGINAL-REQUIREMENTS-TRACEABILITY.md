# Original requirements reconciliation — preserve mandatory scope, record deviations

**Source audit:** 2026-11-23. Compared repository text mirrors `doc1_full.txt` (original "Final Product Requirements & System Architecture") and `doc2_full.txt` ("Master Development Directive — Go Backend Edition", Parts A/B/C). The original `.docx` **Word body contents were decoded and compared directly** against both text mirrors. After whitespace and common dash/quote normalization, both source bodies matched their mirrors exactly. Git blob SHAs: original requirements `f6ce4e35ff93eff19a22649b0641ea20428bd40f`; Go directive `56bbf305e5a0a5cd043df54fb65302727bd14f90`. This is source-content verification, **not** verification of every binary package metadata field, owner approval or production acceptance.

## Exact source-line inventory and review workflow

The [lossless line register](ORIGINAL-REQUIREMENTS-LINE-REGISTER.json) captures 268 nonblank extracted source-section lines spanning all 34 headings, plus five key binding master-directive anchors; headings and multi-part source statements still require decomposition into individually testable requirements. **Do not interpret line count as the number of completed features.** Owner review uses the [decision handoff](REVIEW-AND-ACCEPTANCE-HANDOFF.md) and [DEC-001 options dossier](STACK-DECISION-DOSSIER.md).

## Normative source and the unresolved stack exception

- The **original product scope remains binding unless the product owner explicitly amends it**. This planning baseline does *not* silently delete Windows/macOS/Linux scope, per-process usage, MSI package factory, time-series charts, health scores, operational observability, report formats, permissions or high availability.
- The later master directive **explicitly locks the backend to Go + PostgreSQL** and requires documented architecture-change control/ADR. Actual checked-in code is **Node.js/Express + MySQL 8**. That is a **material unapproved source-to-code deviation** until the product owner chooses and records one of:
  - **DEC-001A:** formally accept Node/MySQL with an ADR documenting why, migration/compatibility tradeoffs, owner sign-off, data model and scaling/retention consequences; or
  - **DEC-001B:** enforce original Go/PostgreSQL lock with a staged redesign/migration plan, tests, cost and delivery impact.
- Neither choice may be silently assumed by a coding agent; no running customer data should be migrated based solely on this planning document. All feature scope remains in either choice.
- Intranet-first one-click setup and 26 safe support cases **extend** original requirements, not replace them. First LAN release may be phased Windows-first **only if the owner approves delivery sequencing**; macOS/Linux remains in the product backlog and original DoD unless expressly revised.

## 34 original requirement sections — section-level traceability

Statuses below describe **coverage, not release acceptance**. Each original bullet must be atomized into a testable line-level requirement before its implementation PR; this table is a *section-level* preliminary RTM, not proof that all 200+ subrequirements are implemented.

| Source section | Requirement theme (preserved) | Current coverage / gap | Planned trace |
|---|---|---|---|
| OR-01 / `1` | Enterprise endpoint product incl Windows/macOS/Linux | Windows-focused Node/MySQL implementation; no multi-OS E2E | PR-015, M7 |
| OR-02 / `2` | Secure API, queue, services, PostgreSQL/time-series, scaling | **Architecture conflict** (Node/MySQL vs locked Go/Postgres), decision pending | DEC-001 |
| OR-03 / `3` | Agent lifecycle: updates, tamper, rotation, offline queue and decommission | Windows agent / queue partially tested; full lifecycle/other OS pending | PR-016, PR-019 |
| OR-04 / `4` | **Mandatory in-platform signed MSI Package Factory** with tenant/group/policy/enrollment profiles and secure downloads | Diagnostic MSI + package APIs exist; signed tenant-specific factory/end-to-end not proved; Windows scheduled task vs original "Windows service" | PR-016, PR-027 |
| OR-05 / `5` | OS inventory, ID, ownership, assigned user, lifecycle, patch state | Partial windows inventory, multi-OS/site lifecycle pending | PR-015 |
| OR-06 / `6` | CPU, memory, GPU, BIOS, disk, battery, peripherals hardware | Partial Windows collectors; parity, temperatures, GPU and field accuracy pending | PR-017 |
| OR-07 / `7` | 30–60s telemetry and real 1h/24h/7d/30d history | Measured telemetry exists; full metric/interval/chart contract unproven | PR-017 |
| OR-08 / `8` | Software, running processes and app usage history/consumption | Inventory/process endpoints exist, complete usage evidence unproven | PR-023 |
| OR-09 / `9` | Adapter, VPN, signal, per-process bandwidth, history | Basic network diagnostics; full usage/history pending | PR-017 |
| OR-10 / `10` | Disk SMART/IOPS/temperature/health trends | Disk-health collector; per-device real metrics depth pending | PR-017 |
| OR-11 / `11` | Battery design capacity/cycles/health trend | Partial collector; battery report/health trend not field verified | PR-017 |
| OR-12 / `12` | Explainable configurable 0–100 Device Health Score | No fully verified policy-weighted health-score engine | PR-018 |
| OR-13 / `13` | Firewall, AV/EDR, OS update, BitLocker, TPM/UAC/local admins | Agent posture partial; secure boot/local admins unverified, no MDM attestation | PR-017 |
| OR-14 / `14` | Patch/software compliance: detect, approve, deploy, verify | API approves DB status; device patch deployment absent | FE-14 |
| OR-15 / `15` | Asset lifecycle discovered→retired incl ownership/replacement history | Device records exist; complete governed lifecycle unverified | PR-020 |
| OR-16 / `16` | Tenant/site/group policies, config sync, version/history | Workspace, group/policy records; effective agent policy lifecycle partial | PR-020 |
| OR-17 / `17` | Alerts cooldown/dedupe, recovery, maintenance, channels | Rule/outbox exists; production channels and full lifecycle acceptance pending | FE-10 |
| OR-18 / `18` | Safe approved remediation with execution verified/audited | Signed commands + queue; full playbook executor and actual fixes absent | FE-16, M4 |
| OR-19 / `19` | Boot/crash/service/network/sleep events | Event ingestion exists; all OS event categories not validated | PR-017 |
| OR-20 / `20` | Full device-detail analytics and admin UX | Dashboard views exist; historical detail/real data validation incomplete | FE-08, PR-017 |
| OR-21 / `21` | Domain services incl package builder/audit/integrations | Single Node server modules exist; service topology change decision pending | DEC-001, PR-016 |
| OR-22 / `22` | PostgreSQL-style relational/time-series store and archival | MySQL migrations/partitioning, source-stack deviation; measured scope partial | DEC-001, PR-017 |
| OR-23 / `23` | Secure schema-versioned agent API, configurable fast sampling/batching | HTTPS token, offline queue, receipts; full intervals/compression/backpressure pending | PR-017, PR-019 |
| OR-24 / `24` | Fine-grained RBAC roles, tenant/site/group scope, MFA-ready | RBAC and workspace flow present; full privilege granularity and other roles pending | PR-020 |
| OR-25 / `25` | Tamper-resistant actor/target/old-new action audit | Audit code exists, full retention and tamper-evidence acceptance pending | PR-021 |
| OR-26 / `26` | CSV/Excel/PDF, scheduled filtered reports | CSV routes exist; Excel/PDF/scheduled coverage incomplete | PR-021 |
| OR-27 / `27` | OpenAPI, webhook/email, SIEM/ITSM/CMDB readiness | API/webhook controls exist; external ITSM/Graph not connected | PR-022 |
| OR-28 / `28` | Retention, aggregation, per-tenant privacy and minimization | Retention/migrations exist; compliance and tenant policy depth pending | PR-021 |
| OR-29 / `29` | Scale/HA, queue workers, tracing, idempotency/backpressure | Durable tests and MySQL indexes; real HA/load proof absent | PR-022 |
| OR-30 / `30` | Platform health/latency/error, queues, workers, MSI health | Healthz exists; integrated SLO observability not accepted | PR-022 |
| OR-31 / `31` | Original MVP→advanced phased scope | New product milestones **add** offline deployment and TR cases; original phases retained | DELIVERY-ROADMAP |
| OR-32 / `32` | NFR: real telemetry, unique ID, audit, offline agent, signed MSI | Partially code/CI verified; office/signer/collector E2E pending | ACCEPTANCE-TEST-MATRIX |
| OR-33 / `33` | Whole original definition of done | No physical signed MSI, full telemetry graphs and field agent evidence | AT-OR group |
| OR-34 / `34` | Master scope preservation | **Not waived** by current code or phased delivery | This crosswalk + owner sign-off |

## Additional master directive controls

| Control | Requirement preserved / decision status |
|---|---|
| DIR-A1 | Decide service topology through ADR: modular monolith vs workers vs microservices. Actual Node monolith exists but no new owner-approved architecture deviation recorded here. |
| DIR-A2 | MSI builder is a first-class signing/authorization/tenant-sensitive backend subsystem, **not** merely a downloadable generic diagnostic MSI. |
| DIR-A3 | No synthetic/mock device telemetry in production; distinguish fresh, stale, missing and device-reported data accurately. |
| DIR-B | **Go + PostgreSQL stack lock**; material conflict with Node/MySQL requires DEC-001 resolution. |
| DIR-RTM | Requirement-by-requirement traceability, test evidence and gap management before further implementation. |
| DIR-ADR | Material design/stack changes need explicit ADR, impact, owner decision and updated contracts. |
| DIR-AI | If AI issue triage is offered, it can only recommend or invoke approved, audited tools; no arbitrary script/secret or privileged system access. |

## Owner decisions and next actions

- **DEC-001 (BLOCKING ARCHITECTURE REVIEW):** approve/deny proposed Node/MySQL departure from original Go/PostgreSQL lock. Record exact ADR and migration/compatibility/observability constraints. This documentation PR **does not decide for the owner**.
- **DEC-002 (PENDING DELIVERY PHASING):** agree Windows-first intranet acceptance with macOS/Linux parity kept on a funded later milestone; or mandate all 3 for initial release.
- **DEC-003 (PENDING MSI MODEL):** reconcile mandatory in-platform per-tenant MSI Package Factory and Windows-service expectation with generic MSI + Windows scheduled-task implementation; never solve by embedding long-lived secrets.
- **DEC-004 (PENDING REPORTS/METRICS):** agree timeline for rich 1h/24h/7d/30d graphs, original weighted health scores, all reports and original advanced inventory.
- **DEC-005 (PENDING TROUBLESHOOTING POLICY):** approve 26 new issue-type scope, D0–D3 tiers, employee self-service and auditable repair resolution as additions, not replacements.

No scope row above should be marked REMOVED or COMPLETED without evidence and explicit user/owner decision. This crosswalk **does not supersede the original DOCX requirements**; it preserves their unresolved obligations.
