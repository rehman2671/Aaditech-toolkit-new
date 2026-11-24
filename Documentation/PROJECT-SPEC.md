# IT-Toolkit - Project Spec (Clean-Room Conceptual Specification)

> **ORIGINAL SCOPE PRESERVED:** The original requirements DOCX and Go Backend Edition directive remain scope authorities until an explicit owner ADR; see [original-source crosswalk](../docs/product/ORIGINAL-REQUIREMENTS-TRACEABILITY.md). Full Windows/macOS/Linux and signed in-platform MSI builder obligations are not waived.
>
> **CURRENT PRODUCT BASELINE (2026-11-23):** This is a *historical clean-room design*, not the implemented production architecture. Its FastAPI/PostgreSQL and historical mTLS assumptions are superseded for current delivery by [the intranet-first product architecture](../docs/product/INTRANET-ARCHITECTURE.md) and [requirements](../docs/product/PRODUCT-REQUIREMENTS.md). Actual code: Node.js/Express + MySQL 8; no verified offline one-click office installer yet. Preserve this document for design history, not as an operator deployment procedure.


> **Phase O checkpoint (2026-11-24):** [PR #109](https://github.com/rehman2671/Aaditech-toolkit-new/pull/109) tested head `7b4a0ebf2b65eb638d0e2da7a0b1aa6bbb72601a` passed unsigned Windows lifecycle and isolated MySQL CI. The historical elevated SYSTEM task design below is retired in the review candidate; routine NETWORK SERVICE only, with unapproved privileged operations default-denied. See [current evidence](../docs/product/PHASE-O-MASTER-INTEGRATION.md). No original scope change, architecture approval or signed release; new patches require fresh CI.

> **Purpose:** This document describes the complete IT-Toolkit platform **by
> concept** - what each part does, why it exists, how it should behave, and the
> clean design-level contracts between components. It is written to let a
> developer (human or AI agent) rebuild the platform **fresh and correct**,
> without inheriting any existing implementation bugs or mismatches.
>
> It is intentionally **not** a copy of the current source. Every feature below
> is expressed as design intent; where the current code has known pitfalls
> (e.g. repo-URL normalization, NULL-company visibility, file-encoding
> issues), they are folded in as **design rules**, not ported as bugs.
>
> **How to use:** read Part 0 first, then each layer's concepts + contracts.
> Part 6 gives acceptance checks that define "the build is correct".

---

## Part 0 - Project Philosophy

### 0.1 What the platform is

Three additive layers:

```
Layer 1  Base Windows Toolkit      standalone scripts + GUI + WinRM remote tools
Layer 2  Enterprise Agent          packaged PowerShell collectors -> exe/MSI
Layer 3  Enterprise Server         FastAPI + PostgreSQL + Caddy + web portal
```

The Enterprise layers (2 and 3) are **additive**: they wrap and extend the
existing toolkit without changing its standalone behavior. A technician can
still use the toolkit directly on a PC; the Enterprise agent just also ships
the collected data to the central server.

### 0.2 Design principles

1. **Additive, zero-change:** the base toolkit keeps working as-is; the agent
   calls its existing scripts for data collection.
2. **LAN/intranet-first:** default deployment advertises the server's LAN IP so
   same-network clients reach it. Internet exposure is an opt-in mode.
3. **Agent identity is the trust root:** every agent authenticates with an
   mTLS client certificate signed by a locally-generated CA, plus a per-agent
   bearer token after first enrollment.
4. **Clean contracts, explicit behavior:** each component has a defined input
   and output; the server is the single source of truth for state.
5. **Security by default:** PII sanitized at the source, secrets encrypted at
   rest, least-privilege execution, admin-only sensitive endpoints.

### 0.3 How contracts are written in this spec

- **Entity** = a persistent object (table) with its fields and relationships.
- **API area** = a group of endpoints with method / path / purpose / role gate.
- **Payload shape** = the JSON fields a collector or endpoint produces.
- **Protocol flow** = the sequence of requests between agent and server.

---

## Part 1 - Layer 1: Base Windows Toolkit

### 1.1 Concept

A set of PowerShell diagnostic/repair tools driven by batch launchers
(`Toolkit-Menu.bat`, `Setup-Wizard.bat`). The menu exposes ~17 numbered
options: local tools, remote tools, and a GUI dashboard. Everything is
PowerShell-first so it runs with the Windows PowerShell 5.1 present on any
admin machine, with no external dependencies beyond what ships with Windows
plus `sqlite3` (bundled) for local data.

### 1.2 Tools and their concepts

| Tool | Concept |
|---|---|
| QuickCheck | One-shot system health + inventory snapshot for a machine |
| Export-EventLogs | Export System/Application/Security logs, **sanitized** (strip usernames, IPs, paths that look sensitive) |
| Network-Diagnostic | IP config, DNS resolution, ping, connectivity checks |
| Firewall-Test | Validate Windows Firewall status and rules |
| User-Inventory | Enumerate local users and groups (needs elevation) |
| Printer-Fix | Detect and repair common printer issues (needs elevation) |
| Pin-QuickAccess | Pin folders into Explorer Quick Access |

**Remote tools (WinRM):** remote QuickCheck, remote network diagnostic, and
batch scan across multiple machines in parallel.

**Modules (shared libraries):**

| Module | Concept |
|---|---|
| SanitizeEngine | Strip PII from free text before it is stored or exported |
| CredentialManager | Store secrets in a Windows DPAPI vault (never plaintext) |
| ToolkitData | Local sqlite store for inventory snapshots |
| ExportEngine | Uniform CSV/JSON/HTML export of results |
| ReportGenerator | Human-readable report assembly |
| RemoteToolkit | WinRM connection + parallel remote invocation |
| TaskScheduler | Register scheduled runs of any tool |
| AlertEngine | Local alert evaluation against collected data |
| LogManager | Consistent log/rotation for toolkit runs |
| ToolkitConfig | Read/merge config files and defaults |

### 1.3 Contracts (design level)

- Every tool: **input** = a target (local or remote host), optional params;
  **output** = one structured result object plus a log line.
- Sanitization is applied at **write time** (before storage/export), and each
  output declares whether it is `sanitized: true/false`.
- GUI dashboard is Windows-only; headless environments get exit code 2.

---

## Part 2 - Layer 2: Enterprise Agent

### 2.1 Concept

A small Windows service-style client installed via an MSI. It runs on a
schedule as a low-privilege account (`NETWORK SERVICE`), invokes collectors,
and ships the results to the server over a mutually-authenticated TLS channel.
Administrative actions (licensed collectors, MSI self-upgrade, scheduled
reboot) are staged to an on-demand elevated task that the unprivileged agent
can trigger but not bypass.

### 2.2 Collector features

Each collector produces **one event** per cycle. `default` = enabled on a
fresh install; `elevated` = runs in the elevated task.

| Collector | kind | default | elevated | Data produced |
|---|---|---|---|---|
| System Quick Check | `quickcheck` | on | no | health + inventory snapshot |
| Event Logs | `eventlogs` | on | no | sanitized system/app/security logs |
| Network Diagnostics | `network` | on | no | IP/DNS/ping/connectivity |
| Firewall Audit | `firewall` | on | no | firewall status + rules |
| Hardware Inventory | `hardware` | on | no | CPU, RAM, disks, GPU, BIOS, serial, battery wear % |
| Software Inventory | `software` | on | no | installed apps + versions |
| Disk Health | `diskhealth` | on | no | physical disk health + SMART failure prediction |
| System Health | `health` | on | no | uptime, CPU/RAM %, reboot-pending, critical services |
| Update Compliance | `updatecompliance` | on | no | last Windows Update activity |
| User Inventory | `users` | off | yes | local users/groups |
| Printer Diagnostics | `printers` | off | yes | printer state/issues |
| BitLocker Status | `bitlocker` | off | yes | volume encryption state |
| License Info | `licenses` | off | yes | **Windows/Office key last-5 chars only** (never full keys) |

**Payload shape (all collectors):**

```json
{
  "kind": "health",
  "payload": { "...feature fields..." },
  "captured_at": "ISO-8601 timestamp",
  "client_msg_id": "unique id for at-most-once delivery"
}
```

### 2.3 Agent lifecycle concepts

- **Heartbeat:** a cheap liveness ping (hostname + OS/IP/version) that keeps
  `last_seen` fresh and lets the server detect offline agents.
- **Enrollment / token:** on first contact the agent receives a per-agent
  bearer token; the shared fleet token is retired for that agent.
- **Commands:** the agent polls for pending commands and executes:
  - `reboot` - schedule a reboot (elevated)
  - `wake` - Wake-on-LAN
  - `run-script` - only scripts on a server-side allowlist, gated by config
- **Self-update:** the agent checks a rollout target version; if the MSI is
  newer it downloads and installs it silently (elevated).
- **Revocation:** an operator can revoke an agent; revoked agents are rejected
  even with a valid token.
- **Resilience:** exponential backoff with jitter on delivery failure, bounded
  outbox, dedupe via `client_msg_id` so a retried batch is not double-counted.

### 2.4 Agent -> server protocol (design level)

| Flow | Endpoint (conceptual) | Direction | Auth |
|---|---|---|---|
| Heartbeat | `POST /api/agent/heartbeat` | agent -> server | agent token + mTLS |
| Ingest events | `POST /ingest` | agent -> server | agent token + mTLS |
| Poll commands | `GET /api/commands/poll?hostname=` | server <- agent | agent token + mTLS |
| Command result | `POST /api/commands/{id}/result` | agent -> server | agent token + mTLS |
| Update check | `GET /api/agent/update` | agent -> server | agent token + mTLS |
| MSI download | `GET /api/agent/msi` | agent -> server | agent token + mTLS |

**Design rule:** the server must reject batches that are malformed, exceed the
body/event limits, or carry a duplicate `client_msg_id` (rollback the batch).
Licensed events (`licenses`) must be gated so only admins can read them.

---

## Part 3 - Layer 3: Enterprise Server

### 3.1 Concept

A single-host Docker stack: **API (FastAPI) + PostgreSQL + Caddy**. Caddy
serves the web portal on `:80/:443` and an mTLS-only agent port (e.g. `:9443`).
The API is the single source of truth for agents, events, alerts, commands,
users, and companies.

### 3.2 Data model (clean design)

| Entity | Purpose | Key relationships |
|---|---|---|
| `agents` | one row per enrolled machine | unique hostname; belongs to a company; has token + last_seen |
| `events` | one row per collected event | FK agent; unique `client_msg_id`; indexed `(kind, agent_id, captured_at)` |
| `feature_configs` | per-feature on/off + config | keyed by feature name |
| `settings` | key/value server settings | secrets stored encrypted |
| `users` | portal accounts | unique username; role; belongs to a company |
| `commands` | command queue | FK agent; status pending/picked_up/completed; result payload |
| `alert_rules` | evaluatable rules | name unique; condition JSONB; severity; enabled |
| `alerts` | opened alerts | FK rule + agent; status open/acknowledged/resolved |
| `audit_log` | security-relevant trail | user, action, target, IP, detail |
| `companies` | tenants (multi-tenant) | agents + users belong to one; one default |

**Design rules:**
- Agents/users **always** have a `company_id` (F4). Rows without one
  (legacy/pre-tenant data) are treated as **unassigned** and remain visible to
  every company user: scope clause is `company_id = <mine> OR company_id IS NULL`.
  Cross-tenant isolation must still hold (another company's agents are never
  visible).
- Startup-only migrations: schema applied at boot, no destructive auto-changes.
- Index for "latest event per agent" lookups (software/license compliance).

### 3.3 API surface (areas + role gates)

| Area | Purpose | Example endpoints | Role gate |
|---|---|---|---|
| Setup | one-shot first-run wizard | `GET/POST /api/setup*` | open (pre-setup only) |
| Auth | login/logout/me/bootstrap | `POST /api/login`, `GET /api/me`, `GET /api/bootstrap` | session |
| Users | portal accounts CRUD | `GET/POST/PUT /api/users*` | admin/operation |
| Agents | list, token, revoke | `GET /api/agents*`, `POST /api/agents/{id}/revoke` | session / admin |
| Ingest | agent events | `POST /ingest` | agent token + mTLS |
| Events | read collected events | `GET /api/events` | session (licenses = admin) |
| Commands | create/poll/result | `GET/POST /api/commands*` | session / agent |
| Alerts | rules, open, ack/resolve, channels | `GET /api/alerts*`, `PUT /api/alert-rules/{name}` | session / admin |
| Software (F3) | search/export/compliance | `GET /api/software/*`, `GET /api/license/*` | session / admin |
| Reports | fleet + per-agent summary | `GET /api/report/*` | session |
| Features | toggle collectors | `GET/PUT /api/features*` | session / admin |
| Companies (F4) | tenants + default | `GET/POST /api/companies`, `GET/POST /api/settings/default-company` | admin |
| Build | remote MSI build | `GET/POST /api/build/*` | admin/operation |
| Ops | health/metrics/status/audit | `GET /healthz`, `GET /metrics`, `GET /api/audit` | open / session / admin |

**Auth model concepts:**
- Portal: session cookie; three roles - `admin`, `operation`, `monitoring`.
- Agent: mTLS client cert + per-agent bearer token.
- Secrets-at-rest: SMTP passwords and GitHub PATs are encrypted (Fernet-style
  vault), never stored plaintext.
- Rate limit login attempts and lock out a user after repeated failures.

### 3.4 Web portal (10 tabs)

| Tab | Concept |
|---|---|
| Agents | list of enrolled machines (hostname/OS/IP/version/last-seen) |
| Fleet | live health, disk, hardware, update compliance, offline detection |
| Events | full event history + raw JSON viewer |
| Commands | send reboot/wake/script, see delivery + result |
| Alerts | rule management + delivery config (SMTP/webhook/Slack/Teams) + live test |
| Software | fleet app search + CSV export + license compliance (F3) |
| Reports | fleet summary + per-agent detail |
| Features | toggle any collector on/off |
| Users | user CRUD + Companies manager (multi-tenant) |
| Agent Setup | MSI status, GitHub remote build, install-agent.cmd, CA download |

### 3.5 Multi-tenant (F4) - concept

Setup creates a **company** and binds the admin to it. New agents enroll into
the **current default company**. All list queries are scoped to the caller's
company. Admins can create companies, list the directory (with user/agent
counts), and repoint the default. `bootstrap` returns the caller's tenant and
(for admins) the company directory.

### 3.6 Alerts - concept

Rules are stored with a JSONB condition. A background evaluator runs each rule
against each agent's latest events and **opens an alert once** (no duplicates
for the same pair while open) and **resolves it when the condition clears**.

Built-in rules:
- `agent-offline` - no heartbeat within N minutes (warning)
- `disk-low` - logical disk free below N% (warning)
- `smart-predict` - SMART imminent failure (critical)
- `battery-low` - charge below N% (warning)
- `service-down` - critical auto-start service stopped (warning)
- `reboot-pending` - pending reboot + high uptime (info)

Delivery channels (configurable + live-testable):
- SMTP email
- Generic JSON webhook
- Slack incoming webhook (blocks format)
- Microsoft Teams connector (MessageCard)

**Design rule:** delivery runs in a background worker so the evaluation loop
is never blocked by a slow SMTP/webhook call.

### 3.7 Software inventory + license compliance (F3) - concept

- **Search:** fleet-wide case-insensitive search by app name/publisher across
  each agent's latest `software` event; empty query lists all.
- **Export:** CSV of hostname + apps.
- **Compliance (admin-only):** per-agent Windows/Office key **last-5 chars**
  and whether each is present; CSV export available. Full keys never leave the
  agent.

### 3.8 GitHub remote MSI build - concept

A Linux/macOS host cannot build a Windows MSI locally, so the server can
trigger this repo's CI (`workflow_dispatch`), poll the run, and auto-fetch the
finished `IT-Toolkit-Agent.msi` artifact into the artifacts volume, served at
`/api/agent-msi`.

**Design rule (anti-hallucination):** the repo identifier must be normalized
to canonical `owner/repo` on save **and** on every API call. Accept full URLs
(`https://github.com/OWNER/REPO.git`), `git@github.com:` form, trailing `/`,
and `.git` suffixes; never build an API path like
`/repos/https://github.com/...`.

---

## Part 4 - Deployment

### 4.1 Bring-up concept

- **`deploy.sh` (macOS/Linux):** detects LAN IP (or `--public`), generates
  `.env` secrets, writes `agent-config.json` (mTLS endpoint + token), runs
  `docker compose up -d --build`, waits for health, prints next steps.
- **`deploy.ps1` (Windows 10/11 only):** same bring-up plus local agent build
  (ps2exe + WiX) and publish.

### 4.2 Build modes

| Mode | Who builds the MSI | When to use |
|---|---|---|
| `local_windows` | the Windows server (deploy.ps1) | Windows 10/11 host |
| `github` | GitHub Actions, fetched back | Linux/macOS host |
| `manual` | operator builds elsewhere + uploads | anything |

### 4.3 Env contract (design level)

| Var | Concept |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `SERVER_HOST` | advertised host/IP (auto-detect default) |
| `API_TOKEN` | shared fleet token fallback until per-agent tokens exist |
| `SESSION_SECRET` | rotated at first setup; encrypts stored secrets |
| `ENVIRONMENT` | `prod` hides API docs; `dev` exposes them |
| `COMMANDS_RUN_SCRIPT_ALLOWED` + `RUN_SCRIPT_ALLOWLIST` | gate `run-script` |
| `SMTP_*` | email delivery defaults |
| `WEBHOOK_*` | webhook delivery defaults |
| `MAX_*` | ingest/list/body limits (abuse bounds) |

---

## Part 5 - Security model

- **Two trust boundaries:** (a) portal users via session cookies + RBAC;
  (b) agents via mTLS client certs (locally-issued CA) + per-agent tokens.
- **CA + cert lifecycle:** server generates a code-signing CA; agent client
  certs auto-renew before expiry.
- **PII:** sanitized at the collector; sensitive payloads (licenses) are
  admin-only and show last-5 chars only.
- **Secrets:** encrypted at rest (Fernet-style vault), secrets files with
  restrictive permissions (0600 / icacls).
- **Audit:** security-relevant actions logged (login, setup, user, command,
  agent, feature, build) and admin-only to read.
- **Encodings:** all new files are ASCII-safe; PowerShell 5.1 parses no-BOM
  UTF-8 as CP1252, so non-ASCII bytes (e.g. em-dash 0x94) can break parsing.

---

## Part 6 - Acceptance checklist (the build is correct if...)

**Layer 1 (toolkit):**
- [ ] All ~17 menu options launch the intended tool and return to the menu.
- [ ] Sanitization strips PII before any export.
- [ ] GUI dashboard is Windows-gated; headless returns exit code 2.

**Layer 2 (agent):**
- [ ] 13 collectors emit well-formed `{kind, payload, captured_at, client_msg_id}` events.
- [ ] Elevated collectors (users/printers/bitlocker/licenses) run only elevated.
- [ ] Heartbeat keeps `last_seen` fresh; offline detection fires within the rule window.
- [ ] A duplicate `client_msg_id` batch is rejected (no double-count).
- [ ] Command poll -> execute -> result round-trips; revoked agent is rejected.
- [ ] Self-update installs the newer MSI silently when target version advances.

**Layer 3 (server):**
- [ ] Setup is one-shot and transactional (crash never leaves half-configured).
- [ ] RBAC holds: monitoring cannot read licenses/audit; admin-only writes gated.
- [ ] F4 isolation: a Beta-company agent is invisible to an ACME admin; unassigned (NULL company) rows remain visible.
- [ ] Alert rules open once and resolve when the condition clears; email + webhook/Slack/Teams deliver.
- [ ] Software search/export + license compliance return correct, admin-gated results.
- [ ] GitHub build: full-URL repo normalizes to `owner/repo`; validate/trigger/status work with no `/repos/https://...` 404.
- [ ] `/healthz` and `/metrics` respond; audit log records actions.

---

*End of spec. This document is concept-and-contract level: rebuild from here,
verify against Part 6, and treat the current source only as a reference, not
as the definition of correct behavior.*

## Phase O credential authority and acceptance checkpoint (2026-11-24)

[PR #109](https://github.com/rehman2671/Aaditech-toolkit-new/pull/109) prior exact head `41942da70c5c11baf618ad441add9d7c1573b5b7` passed [4/4 executable CI jobs](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45449608007) and [2/2 deployment safety jobs](https://github.com/rehman2671/Aaditech-toolkit-new/actions/runs/45449608037), including unsigned Windows installer lifecycle and typed JS signed-envelope verification. The subsequent combined review candidate incorporates [#110](https://github.com/rehman2671/Aaditech-toolkit-new/pull/110) at `c9128da7a5fbe5c04d60d1663712364735f950ec`: canonical header-only device authentication, unique current token hash authority, tenant-scoped audited revocation, plus a two-process HTTP/MySQL concurrent revocation regression. See the master integration document and delivery tracker for exact evidence and remaining work. New combined head CI pending; rotation/recovery, legacy migration, in-flight cancellation policy, full tenant isolation and physical signed endpoint acceptance remain open. No owner ADR, main merge, independent approval, or production acceptance.


## Phase O revocation verification correction (2026-11-24)

PR #109 exact head ebd4848d826e5bb8e764d95fce701d8a0a794835: Node/Vitest passed and deployment safety #45451309706 passed; CI #45451309686 API fault rehearsal failed at line 214 (401 vs expected 403 after prior revocation/audit/last-seen assertions). Corrected the test to require existing 401 DEVICE_TOKEN_REVOKED contract, retained exact error assertion, added real two-worker legacy/conflicting-header denial tests. Fresh combined CI required; no full revocation or production acceptance yet. Historical unsigned MSI verification remains exact-head evidence; no signer, owner ADR, protected merge or field acceptance.

## Phase O recovery and migration safety checkpoint (2026-11-24)

Exact head 583a7e637d2e3e32cf7612eb7887321ab25b1f48: PowerShell, Node/Vitest and production API/MySQL job SUCCESS (CI 45451912773); deployment safety 45451912586 2/2 SUCCESS; unsigned MSI job still in progress at observation. Production signing skipped.

Recovery preflight implementation: explicit tenant SUPER_ADMIN bearer-only read-only GET by immutable ID, no-store response, persistent database only, categorizes unique/ambiguous/legacy-only/missing/invalid credentials and outstanding commands (including IN_PROGRESS or unknown status), returns blockers and always replacement_allowed=false. No secret/hash returned, no migration, token issuance, mutation or queue cancellation. Added helper/DB regressions and two-production-worker foreign-tenant 404 for revocation/preflight, cookie refusal and pre/post-revocation snapshots. New CI pending; physical recovery, atomic credential replacement, authenticated local handoff, in-flight command policy, legacy migration and independent review still required.

Endpoint: `GET /api/v1/devices/:id/credentials/recovery-preflight`. This is an assessment, not an approval or authorization to rotate credentials; absence of outstanding server commands does not prove no endpoint-side work remains. Revoked devices must not use bootstrap enrollment to overwrite an existing identity. No owner ADR, main merge, signing or production acceptance.

## Phase O command mutation and recovery safety checkpoint (2026-11-24)

Exact head 1b45dad47368b05a90a3b44a5e9fe2c3f40f5905: CI 45452577035 PowerShell, Node/Vitest and real API/MySQL (two-worker cross-tenant revocation/preflight) SUCCESS; deployment safety 45452576922 2/2 SUCCESS. Unsigned Windows MSI still running at observation; protected signing skipped. Previous 583a7e63 MSI cancelled on supersession.

Command mutation fence: deployed claim and terminal result writes now require current tenant/device token hash under the same MySQL device row lock used by revocation, with rollback and fail-closed credential change rejection. New mocked transaction regressions and two-worker HTTP/MySQL claim, result receipt replay, outstanding-command recovery blocker and revoked-result denial rehearsal added. Fresh CI required. Does not cancel or recall a command claimed before revocation, fence every telemetry write or implement credential replacement, rotation or local recovery handoff. Explicit synthetic test compatibility remains.

Lock order is device row first, command row second. A command already claimed can be delivered or run after revocation, and a lost response can leave IN_PROGRESS work; preserve and reconcile it rather than automatically retry or mark it complete. Recovery preflight remains advisory with replacement_allowed=false. Independent review, owner ADRs, protected main, physical endpoint acceptance and signed release remain required.

## Phase O command admission and recovery checkpoint (2026-11-24 IST)

Exact head d5755e1035881675e8e2e7923bc7e33bb7d622f3: CI 45453396797 Node/Vitest FAILED (470/473 tests passed; three N23 production-mode fixtures omitted the newly mandatory credential/transaction interface). API job skipped; PowerShell running at observation. Deployment safety 45453396774 2/2 SUCCESS. Previous head 1b45dad4 unsigned MSI was cancelled, not accepted.

N23 fixture reconciliation preserves production fail-closed behavior and exercises device-row lock plus existing CAS, owner and database-failure assertions. Missing credentials now explicitly tested for claim, completion and queue insertion. Command enqueue additionally uses the same device lock and current credential hash as claim/result/revocation, including direct dispatch and policy-approved remediation; stale or revoked targets return HTTP 409 DEVICE_CREDENTIAL_NOT_ACTIVE without inserting a queue row. Mocked regression expanded to enqueue, and isolated two-worker rehearsal asserts revoked dispatch cannot add queue rows. Fresh combined CI required; no cancellation of preexisting or executing commands, automatic recovery or credential issuance.

Recovery authorization and replacement remain blocked pending transaction/telemetry review, independent endpoint ownership proof, durable single-use authorization, atomic Windows credential storage and reconciliation of outstanding work. No owner ADR, main merge, protected signing or production acceptance. The older Windows diagnostic evidence applies only to its exact tested revision.

## Phase O telemetry transaction credential checkpoint (2026-11-24 IST)

Exact head 16c56b54971e76e06dbb64f4ab35a5f3c66bb07a: CI 45454066429 Node/Vitest (including corrected N23), PowerShell and real API/MySQL passed; unsigned Windows MSI job running at observation, protected signing skipped. Deployment safety 45454066314 both jobs passed.

Keyed telemetry and deployed heartbeat now revalidate the current device credential under the same MySQL device-row lock as revocation. Keyed batches acquire the device lock before any receipt claim, including duplicate ACK replay; foreign, missing, ambiguous, changed or revoked credentials fail closed. Added mocked rejection tests, isolated real MySQL credential-fence rehearsal and two-production-worker HTTP heartbeat/batch/replay/revocation assertions. Legacy unkeyed telemetry still follows the compatibility path and requires separate migration/fencing; test-mode compatibility remains explicit. Optional post-commit Redis application-usage caching is not fenced by this transaction. No new recovery authorization, replacement token, rotation or local handoff. Fresh CI required.

Lock order: device row before receipt or command row. Revocation cannot erase previously committed evidence or cancel work already executing. Recovery preflight remains advisory, replacement disabled; finish legacy telemetry compatibility/mutation review and independent endpoint ownership/authorization design before enabling credential replacement. No main merge, architecture approval, protected signing or production acceptance.

## Phase O legacy telemetry and cache admission checkpoint (2026-11-24 IST)

Exact head dc746c3105cdd81be00b8c19596ef17ad12c9cd2: CI 45454627250 PowerShell, Node/Vitest and real API/MySQL succeeded; N29 real transaction rollback/replay/revoked credential fence and two-production-worker rehearsal confirmed in logs; unsigned Windows MSI running at observation, protected signing skipped. Safety 45454627043 both jobs passed. Prior 16c56b54 unsigned MSI cancelled on supersession.

Deployed canonical and legacy ingest aliases now require batch_id after enrolled-device authentication; unkeyed compatibility path is explicit test-mode only. Legacy standalone script generates per-sample batch ID, checks receipt and stops accepting response-issued replacement credentials; it does not gain the installed MSI worker's durable outbox or restart retry guarantees. Redis app usage now uses an opaque tenant/device/current-credential namespace; deployed readers re-resolve authoritative unique active credential before and after Redis access and never fall back to old keys; stale writes remain in old expiring namespaces, not current live evidence. Same-generation ordering and cross-store atomicity are not guaranteed. Added unit, source and two-worker HTTP regression coverage. Existing unkeyed deployed clients must upgrade; no fleet rollout or actual live Redis acceptance claimed. Fresh CI required; recovery authorization, credential replacement and local handoff remain disabled.

Migration: update legacy clients before deploying the new server contract; the canonical installed agent already uses a durable keyed outbox. Both aliases reject authenticated unkeyed writes with HTTP 400 TELEMETRY_BATCH_ID_REQUIRED. Old Redis app_usage keys expire and are not read by deployed v2 code; future credential replacement must never reuse a prior token. The app usage cache remains optional, not durable proof of freshness or recovery. No owner ADR, main merge, independent approval, signing or production acceptance.

## Phase O command quarantine / recovery prerequisite reconciliation (2026-11-24 IST)

Exact master a0848795fdff741c05c44d9542385b8959f3e801: CI 45456389754 Node/Vitest succeeded; PowerShell and API/MySQL running at observation. Safety 45456389385 both jobs passed. Previous 116413a9 API regression from unkeyed synthetic tenant fixture was corrected in a0848795; fresh full API acceptance remains required.

Selectively reconciled #111 source 5ecd18c1939db92cb187e7721e6d95bb898c6eca command quarantine and previously revoked device reconciliation into master without importing conflicting unkeyed ingestion or migration 016. First revocation atomically cancels only PENDING rows with all pickup/execution/completion timestamps null, audits exact count, retains read-only idempotent retry. Explicit tenant SUPER_ADMIN bearer-only POST /api/v1/devices/:id/credentials/reconcile-pending requires immutable ID confirmation and fixed action CANCEL_NEVER_CLAIMED_PENDING; revoked devices only, remaining outstanding count, audit only on change, replacement_allowed=false. Source unit coverage and two-worker regression integrated; additional active-device 409 and suspicious pending-with-pickup-evidence preservation tests. No in-flight cancellation or credential issuance. Fresh CI required.

Decision for integration: retain master mandatory batch ID and current credential-generation Redis isolation. #111's persistent usage snapshot migration 016 and its alternative deployed unkeyed ingestion remain unintegrated and require separate conflict-aware review; source PR is retained, not merged wholesale. Already claimed or uncertain work remains a recovery blocker. Durable single-use recovery authorization requires independently verified endpoint ownership and owner DEC-003 policy before live issuance; no automatic migration or replacement, main merge, signing or production acceptance.


## Phase O exact-head verification and coverage recovery (2026-11-24)

Master #109 exact head 1c90d4492ecb8f192c28203bac502f772549651f CI #45456930486 4/4 executed SUCCESS (Node, PowerShell, real MySQL API, unsigned Windows MSI); deployment safety #45456930417 SUCCESS. Protected signed build skipped. #111 exact b1ff5176 CI #45457267890 all 483 tests/74 files passed, but statement coverage 69.73% below unchanged 70% threshold; API skipped. Added focused snapshot read/write, explicit empty/absent, duplicate receipt, invalid data, credential, rollback and DB-unavailable tests without reducing coverage gate. Fresh CI required; migration 016 staging backup/restore and physical source acquisition pending. Master quarantine/reconciliation verified at prior exact head, replacement issuance/independent ownership and secure handoff remain blocked.


## Phase O signed recovery evidence boundary (2026-11-24)

Exact #111 e91cd7b1 CI #45458222144 Node/Vitest passed 489/489, statement coverage 71.07% (unchanged 70% threshold), API/PowerShell running at observation. Added review-only Ed25519 recovery evidence verifier, with independently supplied payload and reviewer SPKI pins, canonical bounded JSON, exact tenant/device/request/challenge/current credential fingerprint, <=5-minute trusted-clock validity and separate ownership/reconciliation/local-handoff evidence digests. Negative tests cover tamper, mismatched context, malformed/noncanonical evidence, expiry, and signature/key pins. Verifier is deliberately not wired to HTTP issuance or DB mutation; does not certify referenced evidence, consume grants, or authorize replacement. Durable one-use CAS, reviewer custody and independent endpoint ownership, uncertain command resolution and atomic Windows handoff remain required. Fresh CI required; production not accepted.

## Phase O master application usage and signed recovery evidence integration (2026-11-24 IST)

Exact integration head 1c90d4492ecb8f192c28203bac502f772549651f: CI 45456930486 all four executable jobs passed (PowerShell, Node/Vitest, real API/MySQL, unsigned Windows MSI lifecycle); protected signed MSI skipped. Deployment safety 45456930417 both jobs passed. Exact source #111 e91cd7b1 CI 45458222144 PowerShell, Node/Vitest (489/489, 71.07% statement coverage with unchanged 70% threshold), API/MySQL passed; unsigned and signed MSI jobs skipped. Newer source 6240cf59 fresh CI 45458699873 running at observation.

Integrated exact #111 source 6240cf591c17b27104ac986dbc1d4d1ab982f335 code/migration/test blobs after verifying its merge base equals master 1c90d449. Migration 016 adds bounded one-per-device credential-bound application usage snapshot committed with keyed telemetry; authoritative tenant/current-credential/15-minute freshness read, explicit empty versus not reported, no deployed Redis fallback or historical Redis import. Master keyed-only admission and command quarantine/reconciliation preserved. Integrated review-only Ed25519 recovery-evidence verification helper with pinned artifact digest, reviewer key, request/device/tenant/challenge/current generation and bounded clock, plus negative tests. No HTTP admission, durable grant consumption, evidence truth certification or credential issuance. Fresh combined CI and staging encrypted migration backup/restore rehearsal required. Windows agent app usage collector, independent endpoint proof, durable single-use authorization and physical local handoff remain incomplete.

Source PR #111 is retained as review history. Existing Redis-only evidence is deliberately not backfilled; snapshot payload bounded to 100 records and 64 KiB, stale/revoked/rotated evidence must not appear live. Source snapshot verification is not production deployment acceptance. No approval of DEC-003, independent security review, main merge, live credential replacement or protected signing.


## Phase O durable review reservations (2026-11-24)

Master #109 87e6a504 CI #45458997023 Node passed, API failed in identity-concurrency child process exited before reporting result (0); safety #45458997283 passed. IPC harness now awaits send completion and observes close instead of exit, without weakening race assertions. Source #111 6240cf59 CI #45458699873 all three executed jobs passed. Migration 017 adds persistent review-only requests and one-time signed review reservations (not activation grants), with revoked unique current credential, no unresolved commands, active persisted SUPER_ADMIN, distinct requester/reviewer, DB clock, same device-row lock, exact pins, pending-state CAS and atomic audit. Mock negative coverage and isolated real MySQL concurrent request/reservation test added. No HTTP route, grant consumption, credential issuance, independent key custody or endpoint proof; staged migration/backup, actual ownership, uncertain-command resolution and secure Windows handoff remain required. Fresh combined CI required; production not accepted.


## Phase O review continuity and predictive integrity (2026-11-24)

Batch on #109 eb959573: CI #45459849750 Node passed, API/PowerShell running at observation; safety #45459849717 passed. Hardened review reservation: immutable pre-await inputs, deterministic persisted requester/reviewer locks and live role checks, independent pins for each of three referenced artifacts, post-lock DB expiry recheck; mock and real MySQL negative cases added. In parallel predictive telemetry now counts distinct timestamp observations, rejects conflicting evidence and revoked devices, preserves disk forecast while missing CPU/RAM yields Unrated/null composite health; focused tests added. No activation grant/HTTP issuance, independent evidence custody or physical ownership claim; no policy-configurable score implementation/ADR approval. Fresh CI required. Production not accepted.

## Phase O parallel endpoint, dashboard and recovery review hardening (2026-11-25 IST)

Exact integration deb6a0981fa7cfd6693f76ca1b21bf1fe8067de1: CI 45460379289 Node/Vitest, PowerShell, API/MySQL completed successfully, unsigned MSI running at observation; protected signing skipped. Safety 45460379259 both jobs passed. Existing FE-38 actual portal rendering tests and combined integration tests executed in passing Node job 138681188625; former DESIGN ONLY/NOT_STARTED tracking was stale.

Parallel security batch: installed PowerShell verifier requires canonical 56-character per-device token, typed outer command ID/signature/content, object JSON envelope, integral version, nonblank typed identity/kind, object payload and bounded parsed issue/expiry clock; rejects MAC-valid coercible values. Native fixture corrected from a 55-character token, expanded regressions and added Windows PowerShell 5.1 CI alongside pwsh. Allowlisted script dispatcher requires scalar script name, separator-bounded canonical root and rejects root/descendant reparse points; isolated harmless CI script and junction regression. Local ACL integrity and concurrent path replacement remain separate physical acceptance gates. FE-38 portal now shows measured BitLocker denominator against fleet and treats fresh negative security field as noncompliance even with contradictory overall label; rendering regression extended. Review-only authorization input now requires exact-length typed tenant/device/request IDs and hashes, rejecting coercible or newline-tailed pins before transaction. No live activation grant or endpoint proof. Fresh combined CI required.

Keep FE-38 blocked for independent review and production acceptance despite existing runtime/CI evidence; historical AT-SEC-05 identifier is also used for command-result recovery, so do not overwrite that distinct tracking row. No owner ADR, credential issuance, protected signing, main merge or physical acceptance. Remaining: independent evidence custody, durable activation authority, endpoint local handoff, real application usage collection and encrypted staging migration rehearsal.

## Phase O parallel compatibility, receipt and restore safety batch (2026-11-25 IST)

Exact head 73eee3c56c7ecfe96ef67c24043287a6aca1bb4b: CI 45461689851 Node/Vitest and real API/MySQL succeeded; PowerShell 7 actual verifier and junction containment fixture passed, but Windows PowerShell 5.1 full agent parsing failed near certificate expiry logging (UTF-8 without BOM/non-ASCII punctuation). Unsigned MSI skipped after prerequisite failure; protected signed MSI skipped. Deployment safety 45461689850 succeeded. Do not claim full acceptance.

Parallel batch: canonical worker normalized to ASCII without changing runtime logic to address 5.1 decoding; retained actual PS 5.1 command verifier gate. Heartbeat and telemetry POSTs disable redirects, have bounded 15-second timeout and terminating errors. Durable telemetry ACK requires typed status/batch ID, integer accepted count, Boolean duplicate, parseable recorded_at; malformed receipts retain identical outbox bytes; PS 7/5.1 cadence fixtures extended. Signed recovery-evidence verifier rejects newline-tailed exact-length UUIDs and digests even with matching pinned context, negative signatures tested. Isolated MySQL backup/restore rehearsal reapplies migrations 016/017 idempotently, seeds synthetic revoked device, sealed batch receipt, usage snapshot, and review reservation, deliberately mutates/deletes them, verifies exact restored state and unique recovery challenge constraint. No production restore or encryption claim; fresh CI required. No activation, collection of private usage, or architecture approval.

Migration rehearsal uses existing disposable CI database and current schema, not an old-production-schema upgrade, encrypted off-site backup, or rollback-safe live migration. Actual usage collector remains gated by DEC-002 privacy approval; deployment implementation by DEC-001; recovery issuance by DEC-003/independent custody, local handoff and physical acceptance. No main merge, signing or production acceptance.

## Phase O parallel replay compatibility, restore input integrity and review lifecycle (2026-11-25 IST)

Exact head cbc28e7aa4f24471e80f425a837d97a15fbf2885: CI 45462429321 Node/Vitest and API/MySQL passed; native Windows PowerShell 5.1 and 7 signed command verification/script containment passed; PS7 strict telemetry cadence passed, PS5.1 single-event lost-ACK retry assertion failed, unsigned MSI skipped. Safety 45462429336 both jobs passed, with actual security-state restoration and duplicate challenge refusal confirmed in job 138688350821.

Parallel batch: normalize SQLite JSON array parsing across PS5.1/7 by assigning decoded arrays before normalization; retain immutable stored batch, validate positive distinct bounded event IDs, stored body batch ID/event count and corresponding client ID suffix before sending. Multi-event/corrupt-ID regression and safe fixture logging added. Restore stages SQL and sidecar in a private temporary directory before validation; import staged bytes, not a mutable source pathname; fake Docker test replaces original after validation and verifies original staged bytes imported. Internal read-only inspectRecoveryReview validates persisted request scope, state/time, generation and current active admins under locks, returns categorical pending/reserved/expired/stale status with no proof secrets or activation, mock and real MySQL coverage. Fresh CI required; no new migration, no issuance, no HTTP endpoint. Staged restore remains plaintext, not protection against a privileged attacker or replacement of both source and checksum before validation.

Retain PS5.1 gate and exact receipt checks, do not weaken acceptance. Independent evidence custody, approved activation policy, secure Windows handoff, encrypted offsite backup and operator restore approval remain required. DEC-001/002/003 decisions not inferred; no main merge, signing or production acceptance.

## Phase O parallel encrypted rehearsal and review expiry checkpoint (2026-11-25 IST)

Exact head fc42a8c29c01343b12897c720ea4a071405422cc: CI 45463569787 Node/Vitest, PowerShell (both PS5.1/7 command and durable ACK tests), real API/MySQL passed; unsigned MSI running at observation, protected signing skipped. Safety 45463569642 actual MySQL restore passed; offline regression failed because the synthetic sidecar was copied over the candidate SQL filename instead of candidate.sql.sha256. Correct fixture without weakening validation.

Parallel backup/recovery batch: correct staged restore fixture destination; reject incomplete mysqldump even on zero exit and noncanonical/oversized retention values before Docker; add offline negatives. Existing bounded POSIX AES-256-GCM and pinned Ed25519 manifest reference now exercised on actual isolated MySQL dump via CI-only helper, ephemeral in-memory keys, wrong-key refusal, exact recovered SQL comparison and normal explicit --db-only restore with security-table preservation assertions. This is a bounded 64 MiB disposable fixture, not a live production encrypted backup executor. Review request admission now scopes open window to current credential fingerprint and effective signed reservation expiry, retaining old records/challenge/evidence uniqueness; unit SQL contract and real MySQL expired reservation regression. No HTTP route, grant, token issuance, new migration or production approval. Fresh CI required.

DEC-001/002/003 remain owner-gated. Independent signer/key custody, streaming large backups, authenticated offsite restore/old-host fencing, activation policy and physical Windows handoff not implemented. Existing plaintext backup remains; encryption exercised only in isolated CI, no production backup format or restore policy changed. No main merge or signing.

## Phase O parallel troubleshooting and setup progress foundation (2026-11-25 IST)

Exact prior head 2f01ffd8b56e087f08895d97e7ab2b8ad486a8e0: CI 45464297470 all four executable jobs passed including unsigned Windows MSI lifecycle; protected signing skipped. Deployment safety 45464297462 offline job passed, live MySQL job failed at startup socket ERROR 2002 before encrypted recovery ran. Do not claim encrypted restore acceptance.

Parallel batch: isolated MySQL rehearsal requires authenticated TCP connection to the final server (temporary initialization server uses skip-networking), bounded idempotent marker retries and final TCP probe before migration/seed; no retry of ambiguous non-idempotent writes. M4 now has executable advisory catalog TR-01..26 with conservative D3 escalation for physical hazards, malware, blue-screen, display and driver uncertainty; default-deny categorical consent/policy triage, no collector/repair authorization, outcome classifier refuses ACK-as-resolution; unit tests. M2 adds read-only redacted setup progress projection from actually verified independently pinned journal checkpoint, distinguishing RECORDED_COMPLETE, RECONCILIATION_REQUIRED and NOT_RECORDED; no paths, IDs, pins, execution or acceptance; tests including all stages recorded and stale checkpoint. Fresh combined CI and encrypted disposable recovery must pass.

M4 moves to IN_DEVELOPMENT as advisory reference only, not integrated product: persistent incident/attempt store, privacy-approved diagnostic adapters, authenticated consent and operator approval, signed playbooks, rollback, independent outcomes and field tests remain pending. DEC-005 remains blocked; conservative policy does not approve D1/D2 execution. M2 remains reference only; no browser endpoint, current anchor distribution, runtime/Windows ACL adapter or setup mutation. DEC-001/002/003/005 remain owner-gated. No protected signing, main merge or production acceptance.

## Phase O parallel incident persistence, signed setup display binding and restore continuity (2026-11-25 IST)

Exact head 8d33c0c1572e12225793614cd811388635c7523c: CI 45477940714 four executable jobs passed, including unsigned MSI lifecycle; protected signing skipped. Deployment safety 45477940884 both jobs passed; real job 138743032490 logs explicitly confirm authenticated AES-GCM disposable MySQL dump recovery and preserved credential revocation, receipt, usage snapshot and review reservation.

Parallel batch: migration 018 and baseline schema introduce internal technician categorical incident intake; authenticated caller and installation identity remain trusted-adapter prerequisites. Active current tenant SUPER_ADMIN and exact device scope locked in transaction, installation/tenant/actor/request idempotency, conflicting retries denied, one atomic audit, redacted own-record inspection, no free text, no employee endpoint, no consent/diagnosis/repair/verified resolution. Mock and actual concurrent MySQL regression included. Expanded encrypted isolated restore rehearsal preserves incident and intake uniqueness. Setup reference verifies short-lived (max 120s) Ed25519 display handoff evidence, independently pinned digest/key, installation/release/current checkpoint/challenge/session binding, canonical bytes and trusted clock; rechecks anchored journal before redacted display projection. No browser login, session authentication, challenge consumption, execution or setup mutation. Fresh combined CI required.

Conservative scope: M4 persists only minimal categorical internal technician intake and escalation, not employee/proactive workflows or attempt records. DEC-005 owner approval, retention/privacy and authenticated adapter remain required before exposure. Installation ID is supplied by trusted internal adapter, not proven by store. M2 remains a reference; independent signer/clock/challenge custody, one-use session handoff and runtime/Windows ACL adapter are pending. No live credential activation, main merge, production signing or acceptance.

## Phase O parallel diagnostic planning and single-use display challenge (2026-11-25 IST)

Exact prior 62c60f600fdf39212621b42e47c6eb64eeb5f478 CI 45479717135 observed: Node.js Unit & Integration Tests (Vitest + MySQL 8): success; PowerShell validation: in_progress; API test suite (Node.js vs MySQL 8): success. Safety 45479717346 both jobs passed; live job 138749275887 logs confirm AES-GCM disposable MySQL dump recovery, preserved incident intake and uniqueness along with revocation, receipt, usage snapshot and recovery reservation.

Parallel batch: migration 019 and schema baseline introduce persistent PLANNED_ONLY diagnostic plan records; exact scoped active admin/device/incident locks, catalog-derived identifier, unknown-hazard and escalated incidents blocked, no command text, consent or execution; per-incident request idempotency and atomic audit, mock and concurrent MySQL regressions. Encrypted disposable restore rehearsal now preserves both open/escalated incidents and diagnostic plan/idempotency keys. POSIX reference consumeSetupDisplayChallenge independently verifies signed display handoff/current anchored journal with copied mutable buffers, checks trusted clock again before exclusive owner-only challenge receipt, fsyncs file/directory, rejects concurrent/replayed challenges; crash-incomplete receipt fails closed, no session authentication or execution. Unit coverage for concurrent consumption and expiry. Fresh combined CI required.

Scope: a diagnostic plan is not an executed attempt; actual diagnostic evidence ingestion, attempt lifecycle, consent/approval, privacy/retention and signed playbooks remain pending DEC-005 and trusted adapters. POSIX receipt requires trusted separate persistent private directory, current independent anchor custody and caller serialization; deletion/whole-ledger rollback, cross-host coordination, clock custody, browser session authentication and Windows ACL adapter are not solved. No actual session grant, recovery activation, main merge, production signing or production acceptance.

## Phase O parallel migration lock, diagnostic evidence and reporting foundation (2026-11-25 IST)

Exact prior 0c67a3caa3235f1ca3f4e56b1adf0d64040d2894 CI 45480282830 observed: Node.js Unit & Integration Tests (Vitest + MySQL 8): success; PowerShell validation: success; API test suite (Node.js vs MySQL 8): success; Phase O unsigned Windows MSI integration rehearsal: in_progress; Build agent exe + MSI: skipped. Safety 45480282914 both jobs passed; live job 138751242518 confirmed AES-GCM disposable MySQL dump recovery preserving diagnostic plans and security records. API job 138751820134 confirmed concurrent intake/diagnostic plan idempotency without action authorization.

Parallel batch: schema migration advisory lock now held on one dedicated MySQL session for lock acquisition, all schema SQL, partition maintenance and confirmed release; acquisition errors/timeouts fail closed and uncertain sessions destroyed. Missing migration directory fails instead of success. Unit tests and real three-connection lock serialization fixture. Signed diagnostic artifact review-only verifier uses bounded canonical JSON, independent payload and Ed25519 key pins, installation/tenant/device/incident/plan/catalog diagnostic/current credential fingerprint/challenge/artifact digest and five-minute clock binding; explicitly not artifact content proof, execution or approval. Scope-limited internal intake aggregate counts reported/open/escalated/distinct planned incidents, leaves unavailable diagnostic, attempt, resolution and rate metrics null; mocked and real MySQL coverage. POSIX setup display ledger rejects nested journal/ledger paths and rechecks time after fsync, burns expired receipt without returning success. Fresh CI required.

No new SQL migration; existing 019 remains latest. Diagnostic evidence verifier is offline only; actual trusted pins, current credential resolution, independently reviewed artifact content, durable attempt records, privacy/retention and DEC-005 remain required. Aggregate is own technician/device scope only, not a tenant dashboard or measured outcomes. Setup ledger still requires external trusted custody, clock, serialization and rollback resistance; no browser auth or Windows ACL adapter. Migration DDL is not transactional rollback; historical checksum drift and production upgrade rehearsal remain separate. No credential activation, automatic repair, main merge, signed release or production acceptance.

## Phase O parallel migration history, credential boundary and diagnostic content checkpoint (2026-11-25 IST)

Exact prior head 840cc9cddef9092bc44f5aab289e723fff180f7b: CI 45481323903 all four executable jobs passed (Node/Vitest, PowerShell, API/MySQL and unsigned Windows MSI lifecycle); protected signed installer skipped. Deployment safety 45481324009 both jobs passed.

Parallel batch: validate all ordered migration source names/versions/checksums and complete recorded prefix before executing pending DDL, fail on missing/unknown/drifted records, never rewrite old checksums automatically; maintain same session lock, defer startup ready until schema validation and migration completes. Unit history tests plus disposable MySQL intentional checksum corruption/refusal/restoration. Windows worker validates canonical per-device token and typed identity/response, refuses bootstrap fallback on malformed existing token or missing paired token, blocks redirects and bounds timeout for enrollment, poll and update check; native cleanup/credential tests run in PS5.1 and 7. Bounded RESOURCE_PRESSURE signed artifact format admits only canonical JSON CPU/RAM/disk percentages or explicit null; rejects extra/private fields and mismatched digest; verifies format/bytes but not measurement truth or execution. Fresh CI required; no new SQL migration.

Strict history verification may intentionally block a historical installation whose applied migration files changed or whose checksum is missing; do not auto-rebaseline. Reconcile against original approved release, independently verify schema/data and rehearse upgrade/restore before operator-authorized repair. Checksums are not publisher signatures or live schema proof; MySQL DDL is not transactionally rollbackable. Windows changes do not supply atomic credential-pair handoff, ACL/DPAPI storage or new trust bootstrap policy; legacy certificate paths require separate review. Diagnostic artifact content is format/digest only, no privacy-sensitive collector, attempt execution, authorization or repair. DEC-001/002/003/005, independent custody, production signing and protected main remain pending. No production acceptance.

### 2026-11-25 implementation evidence addendum

Current review branch #113 hardens persisted recovery review state and internal troubleshooting intake identity/count validation, including uncertain database commit handling. This describes code only; original scope and ADR requirements are unchanged. No credential activation or diagnostic execution accepted.

## 2026-11-25 — Parallel diagnostic, setup and migration evidence batch (#113)

Added bounded canonical signed network-status and disk-capacity/health artifact contracts, explicitly distinguishing null and NOT_RUN from measured observations without collecting private paths, SSIDs or destinations. Setup and installation identity preflight require explicit own data properties, reject inherited/accessor evidence; migration planning rejects malformed entries, line-terminated names/versions and over-limit sequence counts. Six focused regression cases added. No actual endpoint collection, diagnostic execution, repair, installer activation, schema migration change or production approval. Fresh exact-head CI and independent review required; existing #109 and #111 integration boundaries retained.
