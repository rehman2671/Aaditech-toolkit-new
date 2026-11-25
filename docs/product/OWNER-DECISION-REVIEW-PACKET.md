# Proposed owner decision packet — release boundaries and acceptance

**Status: DRAFT FOR PRODUCT OWNER, ARCHITECT AND SECURITY REVIEW. NONE APPROVED.**  
**Baseline:** original DOCX texts verified against repository mirrors; existing code is Node.js/Express + MySQL 8, with a Windows scheduled-task agent, MySQL-backed APIs, signed-command capability and public DNS deployment.  
**Goal:** approve decisions without accidentally waiving original requirements, exposing office data or claiming production acceptance. See [issue #79](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79) and [original-scope crosswalk](ORIGINAL-REQUIREMENTS-TRACEABILITY.md).

## Decision table

| ID | Proposed option for owner consideration | Alternative and explicit tradeoff | Status |
|---|---|---|---|
| **DEC-001** | **A: formally amend original Go/PostgreSQL stack lock to retain Node.js/MySQL.** Reuse tested code, preserve original functional scope and add verified scale/HA/retention architecture. Requires signed ADR and DB/agent compatibility plan. | B: implement original Go/PostgreSQL, with large backend rewrite and safe data migration, contract parity and regression costs. No generic cost number without an engineering spike. | **PENDING; nobody has approved A or B** |
| **DEC-002** | **A: sequence Windows agents first** for an initial LAN release, with macOS/Linux retained as mandatory complete-product roadmap and explicit target acceptance. | B: require all 3 endpoint agents for first LAN release; greater scope and potentially later delivery. Server host OS coverage is a separate test matrix. | **PENDING** |
| **DEC-003** | **A: implement mandatory signed, tenant/group/policy-aware MSI Package Factory** with short-lived bootstrap tokens and original Windows service capability, under approved publisher custody. | B: seek an explicit owner ADR that scheduled-task deployment is technically equivalent in lifecycle/security, while still implementing required signed in-platform MSI factory. Generic diagnostic MSI alone is insufficient. | **PENDING** |
| **DEC-004** | **A: first accept LAN/core functionality, then complete original hardware/GPU/battery/process metrics, health scores, scheduled CSV/Excel/PDF reports and HA/observability with owner-approved dates.** | B: require entire original telemetry/reporting catalog before initial release. Neither option removes the original requirements. | **PENDING** |
| **DEC-005** | **A: D0 read-only diagnosis first; D1 vetted low-risk actions only with organization policy/user notice; D2 consent + IT approval; D3 human-only safety escalation.** Count only independently verified postconditions, never command ACK. | B: diagnostics only, delay all fixes pending separate owner approval. Neither option permits automatic unsafe hardware/malware repairs. | **PENDING** |

**Engineering recommendation, not owner decision:** assess DEC-001A because Node/MySQL APIs, database migrations and real CI evidence already exist. Accept it only after architecture/security review against original Go/PostgreSQL mandate. Separately assess DEC-002A and DEC-005A as a staged delivery policy. DEC-003 must still deliver the first-class secure package builder; nothing in this document authorizes bypassing signing or embedding permanent tokens.

## Decision prerequisites and controlled change

- **Common:** original 34-section crosswalk and line register; user-accepted intranet-first requirements; list of affected API/schema/agent/installer components and non-destructive rollback; independent owner and security reviewer.
- **DEC-001:** product owner signs exact A or B option, ADR number, topology (modular monolith+workers versus alternative), DB migration/no-migration, performance and tenancy/security control parity.
- **DEC-002:** explicitly distinguish **server host operating system support** (Windows Server and Linux installation tests) from **endpoint agent operating system support** (Windows/macOS/Linux original product scope). Date/criteria for full parity require owner record.
- **DEC-003:** validate short-lived enrollment profiles, signed installer build provenance, certificate custody, artifact ACLs, audit, revocation and physical Windows service/task behavior. A signed *generic* MSI is not the full per-tenant package builder.
- **DEC-004:** each deferred capability must remain in source RTM/tracker with measurable acceptance, owner, milestones and evidence. No invented 100% complete state.
- **DEC-005:** sign risk classification for all 26 issue types, user consent/notification, role-based approvals, script allowlists and immutable before/after evidence; burning smell is emergency/human-only, suspected malware human/security led.

## Suggested implementation sequence **only after decisions**

1. Independent review of [docs PR #77](https://github.com/rehman2671/Aaditech-toolkit-new/pull/77) and source/ADR decision by owner; no self-approval.
2. Standalone **FE-38** [security dashboard truthfulness bug #78](https://github.com/rehman2671/Aaditech-toolkit-new/issues/78) may receive a separate code PR without waiting for backend stack decision; requires dashboard negative-path tests.
3. LAN server design [#80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80): private trusted TLS + network preflight, offline bundle, fresh install identity, browser wizard, data-safe restore and physical WAN-off acceptance.
4. Finish per-office Windows enrollment, signed MSI/package-factory requirements and governance [#62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62).
5. Progress D0 read-only then approved D1/D2 remediation with **VERIFIED_RESOLVED** accounting; preserve all original complete-product modules.

## Approval record — intentionally empty

| Decision | Selected option | Owner, UTC/IST timestamp, approval link | Security/architecture review link |
|---|---|---|---|
| DEC-001 | **NOT SELECTED** | Pending | Pending |
| DEC-002 | **NOT SELECTED** | Pending | Pending |
| DEC-003 | **NOT SELECTED** | Pending | Pending |
| DEC-004 | **NOT SELECTED** | Pending | Pending |
| DEC-005 | **NOT SELECTED** | Pending | Pending |

Do not write a selected option into this table without actual external authorization and an ADR. CI green is code validation, not product decision or production acceptance.
