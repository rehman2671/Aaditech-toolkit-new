# IT-Toolkit Enterprise (Phase 3)

> **Phase N status (November 2026):** The authoritative stack is Node.js +
> MySQL 8. Use [`deploy/deploy-mysql.sh`](deploy/deploy-mysql.sh) on a
> Docker-capable Linux VPS with a real DNS hostname and public HTTPS.
> [Backup/restore and deployment runbook](deploy/MYSQL-RECOVERY-AND-DEPLOYMENT.md)
> explains safety and the required acceptance checks. Legacy `deploy.sh`
> and `deploy.ps1` still target PostgreSQL/FastAPI and intentionally refuse
> to run against MySQL. The new installer is generic; see the
> [Windows setup wizard guide](agent/SETUP-WINDOWS.md).
> The current Node API uses HTTPS + per-device tokens; **mutual TLS is not
> implemented**, and live Windows/Hostinger production acceptance is pending.

> **Latest hardening:** [Phase N Stage 9 acceptance](deploy/PHASE-N-STAGE9-ACCEPTANCE.md)
> adds actual CI-only MySQL unique-index migration rehearsal, two-replica
> database partition/recovery tests, and default-deny signing checks.
> **No real production migration, signed public release or Hostinger VPS
> acceptance has been performed.** Historical setup sections below may
> describe obsolete FastAPI/PostgreSQL, self-signed CA, or MSI token-embedding
> workflows: those are **not** current production installation instructions.
> The generic MSI must remain unprovisioned, and production package downloads
> require APPROVED_MSI_SHA256 after independent publisher verification.

Centralized **agent → server → web portal** stack that scales the existing
IT-Toolkit **without modifying any existing script or module**. Everything here
is additive and lives under `Enterprise/`.

```
Windows clients                        Server (Docker, one host)
┌─────────────────────┐                ┌────────────────────────────────┐
│ IT-Toolkit-Agent.exe│  HTTPS POST    │ caddy (TLS)  →  api (Node.js)  │
│ (installed via .msi)│ ─────────────► │                  └──→ portal    │
│ wraps existing      │  sanitized     │                    db (MySQL 8) │
│ Scripts/*.ps1 (raw) │  JSON batches  │                (one shared DB)  │
└─────────────────────┘                └────────────────────────────────┘
```

## Quick start (Node.js + MySQL, Linux VPS and public DNS)

You need Docker Engine, Docker Compose v2, a public DNS hostname that
resolves to this server, reachable TCP ports 80/443, and Caddy ACME
certificate issuance. This is not a Hostinger shared-hosting deployment
without VPS/Docker privileges.

```bash
cd Enterprise/deploy
bash deploy-mysql.sh --host toolkit.your-company.com --dry-run
bash deploy-mysql.sh --host toolkit.your-company.com
```

A first real deployment generates `Enterprise/.env` with eight independent
secrets (including the operator-held initial `SETUP_TOKEN`) and starts MySQL, Node and Caddy. Re-running preserves database
credentials; `--update-host` changes ONLY the DNS hostname. The script
verifies a publicly trusted HTTPS connection and MySQL health before
reporting success. See the [deployment runbook](deploy/MYSQL-RECOVERY-AND-DEPLOYMENT.md)
for database precautions, backup/restore and migration.

The MSI is intentionally **unprovisioned**. Once an HTTPS server and
tenant-scoped enrollment token exist, open **Start Menu → IT-Toolkit →
Configure Agent Server** on the Windows endpoint. The new WinForms wizard
requests UAC elevation, validates the endpoint and configures the agent
without embedding secrets at build time. An administrative PowerShell CLI
remains available. [Windows instructions](agent/SETUP-WINDOWS.md).

**Tenant enrollment safety:** Device enrollment is POST-only, and the
server checks all matching hostnames and device UIDs for cross-workspace
collisions before consuming a one-use bootstrap token. Ambiguous legacy
device records are rejected; they must be resolved by an administrator.
This is not yet a substitute for a complete tenant-scoped database redesign
and concurrent enrollment stress testing.

**Legacy deployment commands:** `deploy.sh` and `deploy.ps1` are
retained for historical reference only and fail closed on this stack.
Do not use their `--regen`/`-Regen` options.

### Required Environment Variables

The server enforces strict zero-fallback secret validation on startup across ALL environments (development, test, and production). The process exits with code 1 if any of the following variables are missing or empty:

- `JWT_SECRET`: Secret key used for signing and verifying user session JWT tokens.
- `HMAC_SECRET`: Secret key used to sign agent check-in payloads and device verification digests.
- `API_TOKEN`: Master API token required for agent authentication and registration.
- `BOOTSTRAP_SECRET`: One-time token signing key for initial agent enrollment.
- `COMMAND_SIGNING_KEY`: Secret key used for cryptographic HMAC-SHA256 signatures on dispatched remote commands.

**Important:** The API fails startup if a required security secret is missing. Do not rely on runtime token auto-generation.

### First-time setup (once, in the browser)

Open the printed URL → a **setup wizard** appears (only until configured):

1. Enter **company name**, confirm the **server address**, create the **first
   admin account**, pick a **brand color**, and choose **how the agent
   installer gets built**:
   - **Windows Server — build locally (automatic)** → the server builds + signs
     the MSI itself (see `deploy.ps1`).
   - **GitHub Actions — remote build (Linux server)** → enter a **GitHub repo
     (`owner/repo`)** + a **PAT** (fine-grained, `Actions: Read/Write`); the
     portal triggers `ci.yml` via `workflow_dispatch` and downloads the signed
     MSI artifact back automatically.
   - **Manual** → you build/upload the MSI yourself.
2. The server then generates everything locally on that machine:
   - a **local CA + server certificate** (persisted in `api_data` under
     `certs/`; `ca.key` stays server-only),
   - an **authentication token**,
   - a **company-scoped agent template** (endpoint + token + CA trust).
3. You land in the branded portal, logged in as admin. On the **Users** page
   (admin-only) create team accounts with roles — **operation** (view + act,
   no user management) or **monitoring** (read-only). The **Agent Setup** tab
   shows the server host, agent token, CA download, and the **build panel**
   (build mode, trigger-a-GitHub-build button, MSI download). Monitoring users
   see dashboards but no config controls.

Public-IP deployment (internet clients): `./deploy.sh --public`, or pin a
fixed address/domain in `.env` (`SERVER_HOST=192.168.1.50` or `SERVER_HOST=it.example.com`).
Moving the server to a different machine later = just re-run `./deploy.sh --regen`.

### Remote GitHub build (Linux server mode)

The API talks to GitHub entirely from the server — the portal never needs your
PAT again after setup (it's stored in the `settings` table and used as the
fallback for `/api/build/*`):

- `GET /api/build/status` — build mode, stored repo, MSI availability, and the
  latest `ci.yml` run (push **or** `workflow_dispatch`); auto-downloads the MSI
  when the newest successful artifact is newer than the one on disk.
- `POST /api/build/validate` — check the repo is reachable + the PAT has access
  (`actions_write` = repo `admin`/`maintain`).
- `POST /api/build/trigger` — fire `workflow_dispatch` on `main` (empty token in
  the body falls back to the stored PAT).
- The download handles GitHub's signed-CDN redirect correctly (no auth header
  forwarded to the CDN), and the MSI is served to agents via
  `GET /api/agent-msi`.

## Quick start (agent + MSI) — build on Windows or a CI runner

```powershell
.\Enterprise\agent\build\build-agent.ps1     # → build/out/IT-Toolkit-Agent.exe
.\Enterprise\agent\wix\build-msi.ps1         # → build/out/IT-Toolkit-Agent-<version>.msi
```

### One-click company install (post-setup)

After the setup wizard, the portal's **Agent Setup** tab generates the company
package: `agent.json` (endpoint + token + company + feature manifest),
`ca.crt`, and a live **install-agent.cmd**. Put all three next to the MSI and
run `install-agent.cmd` (or push the MSI via **Intune / GPO / SCCM** and drop
`agent.json` + `ca.crt` into `C:\ProgramData\ITToolkit-Agent\`).

The server serves these from `GET /api/agent-bundle` (+ `/api/agent/agent.json`,
`/api/agent/install.cmd`, `/api/ca.crt`, `/api/agent-msi`) — admin/operation
only. Where the MSI comes from depends on your setup-wizard choice:

- **local_windows** (`deploy.ps1`) → built + signed on the server, auto-published
  to the `agent_artifacts` volume.
- **github** → built by the `agent-build` CI job on `windows-latest` (WiX v5),
  pulled back by `/api/build/status` into the `agent_artifacts` volume.
- **manual** → copy your own MSI into the volume with:

```bash
# portal serves the versioned download name; store the MSI under the canonical name
docker compose cp IT-Toolkit-Agent-<version>.msi api:/artifacts/IT-Toolkit-Agent.msi
```

## What's in here

| Path | Purpose |
| --- | --- |
| `ARCHITECTURE.md` | Full blueprint (zero-change guarantee, data model, security, migration) |
| `ROADMAP.md` | **Next-steps plan**: CI agent delivery, first-time setup wizard, support-engineer features |
| `docker-compose.yml` | One-host stack: `db` (MySQL 8) + `api` (Node.js) + `caddy` (+ `agent_artifacts` volume for the MSI) |
| `server.js` / root | Node.js Express backend: `POST /ingest`, `/api/agents`, `/api/events`, `/api/features`, setup + login/session + RBAC (`/api/users`), agent bundle (`/api/agent-bundle`, downloads), MSI package generation & download (`/api/v1/msi/*`), alerts + reports + **webhooks (F1)** + **software/license (F3)** + **companies/tenants (F4)** (P6), `/healthz`; serves portal |
| `deploy/deploy.sh` | One-command bring-up (macOS/Linux): auto-IP detection + secrets + mTLS agent config |
| `deploy/deploy.ps1` | One-command bring-up (Windows Server): same as `deploy.sh` **plus** local code-sign CA + ps2exe/WiX MSI build + sign + publish (`BUILD_MODE=local_windows`) |
| `portal/` | Setup wizard + login + single-page admin UI (Agents / Fleet / Events / Commands / Alerts / **Software** / Reports / Feature toggles / Users + **Companies manager** / Agent Setup with build panel) |
| `agent/` | `Agent-Collect.ps1` (worker — collects, parses structured JSON, flushes, polls + executes commands; **auto-installs the server CA into `LocalMachine\Root`**), ps2exe + WiX MSI packaging |
| `agent/collectors/` | 7 support-engineer collectors (hardware, software, diskhealth, health, bitlocker, updatecompliance, licenses) |

## Remote commands (P5)

Admins/operators issue commands from the **Commands** page; agents poll each
cycle and post results back (audited history):

- `reboot` — optional delay in seconds.
- `wake` — Wake-on-LAN magic packet (MAC + optional target IP).
- `run-script` — only when `COMMANDS_RUN_SCRIPT_ALLOWED=true` in `.env` and the
  script path is in `RUN_SCRIPT_ALLOWLIST=Scripts/A.ps1,Scripts/B.ps1`.
- `monitoring` role can view history but not issue.
| `deploy/deploy.sh` | One-command bring-up with auto-IP detection |
| `.env.example` | Template — copy to `.env` (never committed) |

## Alerts + reports (P6)

Seeded rules evaluate on a background loop (`ALERT_EVAL_MINUTES` env, default
1 min) and open an alert when a condition fires, **auto-resolving** when it
clears: agent offline (>15 min), disk < 10% free, SMART predicted failure,
battery < 20%, critical service stopped, reboot pending > 7 days uptime.

- **Alerts page** (portal): status filter (open/acknowledged/resolved/all),
  ack + resolve buttons (admin/operation), and an **open-alert badge** in the
  nav (polls every 30s). Admins can toggle/enable/disable rules and edit
  severity + condition JSON.
- **SMTP email** (P6.1): when `SMTP_HOST` + `SMTP_TO` are set in `.env` (or via
  the setup wizard), the eval loop emails a digest whenever it opens new
  alerts. Verify delivery from the portal with the admin
  `POST /api/alerts/test-email` check.
- **Webhook delivery** (F1): the same digest can be POSTed to a **generic
  JSON**, **Slack** (blocks), or **Microsoft Teams** (MessageCard) webhook —
  independently of, or alongside, SMTP. Configure on the portal Alerts page
  (admin) via `GET/PUT /api/alerts/webhook` and test with
  `POST /api/alerts/test-webhook`. Env fallbacks: `WEBHOOK_ENABLED`,
  `WEBHOOK_URL`, `WEBHOOK_TYPE` (generic | slack | teams).
- **Software inventory** (F3): the **Software** portal tab searches installed
  apps fleet-wide by name/publisher (case-insensitive) and exports CSV:
  `GET /api/software/search?q=`, `GET /api/software/export`. Admins get a
  **license compliance** view (Windows/Office keys as last-5 only):
  `GET /api/license/compliance`, `GET /api/license/export`.
- **Multi-tenant** (F4): setup creates a `companies` tenant; the admin (and
  every user created afterwards) belongs to it, and new agents enroll into the
  current default company. Agent/event/alert/command/user/report queries are
  scoped to the signed-in user's company. Admins manage tenants from the Users
  tab (`GET/POST /api/companies`, `GET/POST /api/settings/default-company`);
  `GET /api/bootstrap` returns the caller's tenant + the company directory.
- **Reports page** (portal): **fleet CSV** (one row per agent, latest
  hardware/health/update snapshot) and **per-agent** JSON/CSV exports.
- API: `GET /api/alerts`, `GET /api/alerts/open`, `POST /api/alerts/{id}/ack`,
  `POST /api/alerts/{id}/resolve`, `GET/PUT /api/alert-rules`,
  `GET /api/report/fleet`, `GET /api/report/agent/{id}?format=json|csv`,
  `POST /api/alerts/test-email`, `GET/PUT /api/alerts/webhook`,
  `POST /api/alerts/test-webhook`, `GET /api/software/search`,
  `GET /api/software/export`, `GET /api/license/compliance`,
  `GET /api/license/export`, `GET/POST /api/companies`,
  `GET/POST /api/settings/default-company` (admins).

## Verified

The full stack was smoke-tested locally with Docker:
ingest (with idempotent dedupe), auth (401 on bad token), agents/events
queries, feature enable/disable, and the portal all pass. `deploy.sh` runs
end-to-end (exit 0) and regenerates the baked agent config on IP change.
The SaaS auto-setup flow (setup wizard → GitHub remote build → MSI download +
serve) was verified live end-to-end, and CI stayed green after both feature
commits.

## Honest boundaries

- Portal sessions + RBAC (admin / operation / monitoring) are live; **alerts +
  reports** shipped in P6, plus webhook delivery (F1), software/license
  compliance (F3) and tenant scoping (F4) on top.
- **MSI is live** (P0): built by CI on `windows-latest` and uploaded to the
  `agent_artifacts` volume — `GET /api/agent-msi` returns a valid installer.
  The `agent-build` job needs the repo secrets `SERVER_ENDPOINT` + `API_TOKEN`
  to bake the endpoint/token; otherwise it stages placeholders and refuses.
- MSI/exe build runs on **Windows** (GitHub Actions `windows-latest`).
- `wake` sends the WOL magic packet from the target's own network via the agent
  (works when the machine has a peer online); for true remote power-on you still
  need the BIOS/WoL setting enabled on the target.
- Agent exe is signed manually (Authenticode) — same boundary as the existing
  smoke-run doc.
- Collectors were verified for **syntax + JSON output** locally (pwsh); full
  Windows-only data (CIM/SMART/BitLocker/WU) needs the Windows smoke run.
- **SaaS auto-setup (Rev 3)**: the setup wizard + `deploy.sh`/`deploy.ps1` +
  GitHub remote-build path are **verified live end-to-end** (setup → trigger →
  poll → auto-download MSI → serve via `/api/agent-msi`). The `deploy.ps1`
  local-Windows build+sign path is written and PowerShell-parse-verified but
  still needs a real Windows Server smoke run.

### PKI and Root Certificate Management
- **Enterprise Root CA**: Provisioned at `certs/ca.crt` as an authentic X.509 PEM certificate (`/api/ca.crt`). This certificate is embedded into deployment scripts (`install-agent.cmd`) and registered into the local Windows Certificate Store (`ROOT` store via `certutil -addstore -f "ROOT" ca.crt`) to establish cryptographic trust for agent communications.
- **Mutual TLS (mTLS)**: Server identity verification via the Enterprise Root CA is fully operational. Full bidirectional mutual TLS with client-side certificate pinning is designated for a future release; agent authentication is currently enforced via cryptographic HMAC-SHA256 signatures, single-use bootstrap tokens, and bearer credentials.
