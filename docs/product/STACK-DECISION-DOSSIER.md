# DEC-001 architecture decision dossier — original Go/PostgreSQL mandate vs existing Node.js/MySQL

**Decision state: OPEN — OWNER APPROVAL REQUIRED.**  
**Prepared:** 2026-11-23.  
**Source:** `Aaditech_Master_Development_Directive_Go_Edition_updated.docx`, repository text mirror `doc2_full.txt` Part B (lines 33–46). The original DOCX Word-body text was independently extracted from GitHub's binary blob and matches `doc2_full.txt` after whitespace and typography normalization; human approval of the directive/architecture remains outstanding.  
**Existing code evidence:** `server.js`, `db.js`, `package.json`, `database/migrations`, `Enterprise/docker-compose.yml`, `Enterprise/deploy/deploy-mysql.sh`.

## Facts that cannot be silently rewritten

The source directive explicitly makes Go the backend implementation language, applies its stack lock to the PostgreSQL backend core and requires owner-approved ADRs for material changes. The currently checked-in implementation is Node.js/Express and MySQL 8. Existing Node/MySQL code and CI are **real evidence of implementation**, but **not** evidence that the source stack lock has already been revoked. The original functional requirements still apply regardless of implementation choice.

User-approved **product direction**: intranet-first, independent office installs, local first-run wizard and optional `tool.aaditechs.in`. This product direction does not by itself decide the backend language.

## Mutually exclusive decision options

| Criterion | DEC-001A — formally retain Node.js/MySQL | DEC-001B — restore mandated Go/PostgreSQL |
|---|---|---|
| Source governance | Requires a signed owner ADR amending the stack lock | Complies with original stack directive; still requires an implementation migration ADR |
| Existing reusable work | High: current Node API, migrations, tests, dashboard and agent contract can be reused | Frontend/PowerShell and protocol concepts reusable; backend and database require major reimplementation |
| Deployment time/risk | Lower implementation rewrite risk; still substantial LAN installer, PKI, identity and E2E work | Higher migration, regressions, new schema/partitioning and data lifecycle risks |
| Existing data | Preserve MySQL; validate MySQL version compatibility, tenant/identity constraints and backups | Design PostgreSQL migration, dual validation, rollback and no-data-loss plan before touching real DB |
| Offline LAN | Both need entirely new trusted offline installation/PKI workflow | Same |
| Contract and tests | Current CI provides useful starting evidence; must verify entire original API/metrics contract and physical agents | Rebuild CI and regenerate API/DB contracts; no regression exemptions |
| Operations | One local Node/MySQL runtime stack, supervised jobs, signed assets and MySQL restore | Go service/worker topology, PostgreSQL backup/restore, new HA/runtime validation |
| Tenant/privacy/security | Preserve current verified controls and address gaps | Re-implement equivalent or stronger tenant/enrollment/command security |
| Estimated effort | **Not quantified** without engineering spike and test plan | **Not quantified** without migration spike and test plan |

**No unilateral selection is made in this PR.** An engineering recommendation may be presented to the owner, but only explicit ADR acceptance can change the mandatory stack.

## Sub-decisions required with either option

- **Topology**: modular monolith + background workers vs future separated services, with worker health and fault domains documented (DIR-A1).
- **Database and migrations**: serialization/locking, idempotent event ingestion, tenant/device unique IDs, telemetry partitions and retention, encrypted backup/restore, upgrade recovery, scale limits.
- **API compatibility**: enumerate all canonical OpenAPI endpoints; verify actual routes and schemas, common Windows/macOS/Linux agent protocol, stable tokens, signatures and signed command semantics.
- **Offline installation**: Windows Server/Linux support matrix, trusted internal PKI, private DNS/IP-SAN matching, offline runtime dependencies, rollback and no-public-domain test.
- **MSI Package Factory**: per-tenant/group/policy authenticated signed package production, not only diagnostic MSI; original Windows-service requirement versus current scheduled-task model (DEC-003).
- **Metrics fidelity**: no fake production telemetry, source provenance, historical timelines and health score, low overhead and privacy controls.

## Required acceptance evidence before closing DEC-001

1. Product owner explicitly records `DEC-001A` or `DEC-001B`, reason and impact (no default).
2. Architecture/security reviewer approves ADR, stack and service topology assumptions.
3. Automated Word-body-to-text-mirror normalized exact-match verification recorded; independent architecture/product **sign-off** is still required.
4. Approved migration/no-migration plan, affected source files/DB tables, rollback, data integrity and cost estimates are attached.
5. Minimum supported OS and original full scope delivery/phasing are accepted under separate DEC-002.
6. Implementation tickets and tests cite the approved ADR; no production cutover based on the document alone.

**Current result:** `DEC-001 = OPEN; status BLOCKED_FOR_OWNER_DECISION`. A green PR/CI does not close the decision.
