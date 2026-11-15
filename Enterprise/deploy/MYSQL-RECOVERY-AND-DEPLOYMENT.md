# Phase N — MySQL recovery and deployment safety

## Authoritative stack

The checked-in production application uses **Node.js/Express** (`server.js`,
`Dockerfile`) and **MySQL 8** (`db.js`, `Enterprise/docker-compose.yml`).
Do **not** attempt to restore PostgreSQL `.dump` files into MySQL.

**Deployment architecture:** The legacy `deploy.sh` and `deploy.ps1`
still contain PostgreSQL/FastAPI logic and intentionally **fail before
making changes**. Use `deploy-mysql.sh` instead on a Docker-capable Linux
server with a real public DNS hostname. It provisions the actual Node/MySQL
stack, preserves existing database credentials and uses Caddy ACME HTTPS.

**Security boundary:** The old `:9443` mTLS listener was not operable with
the Node enrollment endpoint (which issues a per-device token but not a
client PFX). It has been removed from the current Compose/Caddy stack.
Agent traffic now uses regular **HTTPS + server-issued device tokens**.
This is **not mTLS**; implementing and verifying client certificate issuance
and enforcement remains a separate release requirement. Never disable
server TLS verification or copy a shared admin token into a public MSI.

## Docker VPS deployment (new supported path; live acceptance still required)

Set a real domain's A/AAAA DNS record to the VPS, make ports 80/443
reachable, and install Docker Engine + Docker Compose v2. Hostinger
**shared hosting without Docker** is not compatible with this Compose
deployment; choose VPS or another Docker-capable environment.

```bash
cd Enterprise/deploy
bash deploy-mysql.sh --host toolkit.your-company.com --dry-run
bash deploy-mysql.sh --host toolkit.your-company.com
# Later redeploy without rotating secrets:
bash deploy-mysql.sh
# After DNS/hostname migration, explicitly update hostname ONLY:
bash deploy-mysql.sh --host new-toolkit.your-company.com --update-host
```

The first real run generates independent secure secrets in
`Enterprise/.env` if missing; subsequent runs preserve them. It aborts
when an existing MySQL Docker volume exists without its original .env.
Never delete a volume to make a deployment appear successful.
Successful completion requires genuine publicly trusted HTTPS and MySQL
reporting `HEALTHY` on `/healthz`. A dry run is only a configuration
check. Live Hostinger/Windows acceptance is still pending.

## Configure Compose secrets (before deploying)

1. Copy `Enterprise/.env.example` to `Enterprise/.env` and restrict
   permissions (Linux/macOS: `chmod 600 Enterprise/.env`).
2. Set `MYSQL_DATABASE`, `MYSQL_USER`, `SERVER_HOST` and `CADDY_HOST`
   to their intended values. Leave no required secret empty.
3. Generate **independent** random values for `MYSQL_PASSWORD`,
   `MYSQL_ROOT_PASSWORD`, `API_TOKEN`, `JWT_SECRET`,
   `BOOTSTRAP_SECRET`, `HMAC_SECRET`, and `COMMAND_SIGNING_KEY`.
   A suitable generator is `openssl rand -hex 32`, run separately for
   each secret. Never commit `.env`.
4. Validate: `docker compose --env-file Enterprise/.env -f Enterprise/docker-compose.yml config --quiet`.
   This checks substitution; it does **not** prove API/Caddy readiness.

**Existing volumes:** Changing an environment password does not rotate
the password stored inside an initialized MySQL database. Confirm the
current database credentials before editing `.env`. Never run
`docker compose down -v` or delete `mysqldata` as a troubleshooting step:
that destroys the database.

## Transactionally consistent backup

On a configured host with Docker Compose v2 and an accessible database:

```bash
cd Enterprise/deploy
./backup.sh
BACKUP_KEEP=7 ./backup.sh
```

Backups are written atomically to `Enterprise/deploy/backups/ittoolkit-<date>-<pid>.sql`
with owner-only permissions. The MySQL client runs inside the `db`
container. A successful dump includes schema, table data, triggers,
routines and events. `--single-transaction` is consistent for **InnoDB**
tables; pause schema migrations and DDL while a backup is running.
Backups may contain personal or sensitive device data. Copy them to
encrypted, access-controlled **off-host** storage. Test restores regularly.

Retention prunes only dated `ittoolkit-*.sql` files from the backup folder.
`BACKUP_KEEP=0` retains all. Older PostgreSQL `.dump` backups remain
untouched and are **not** compatible with this workflow.

## Destructive restore — explicit authorization

```bash
cd Enterprise/deploy
./restore.sh --yes /absolute/path/to/ittoolkit-YYYYMMDD-HHMMSS-PID.sql
# or restore newest backup:
./restore.sh --yes
```

The script checks the MySQL backup signature and database identity **before**
stopping services. It then:

1. Stops the API and Caddy to quiesce application writes.
2. Makes a **new, independent safety backup** of the current database.
3. Drops and recreates the configured MySQL database and imports the dump.
4. Verifies that the restored database contains tables.
5. Restarts the API/Caddy only after the import and checks succeed.

**If any restore step fails:** application services remain stopped. Inspect
container logs, correct the failure, and restore from the independent safety
backup before bringing the application online. The dump must be from a
trusted source: SQL backups are executable SQL, not safe arbitrary uploads.
The Docker `MYSQL_USER` must have database CREATE/DROP privileges (the
official MySQL image grants these on its initialized database).

Rehearse on a separate, isolated deployment before using in production;
this repository change alone does **not** constitute a live restore test.
If TLS/mTLS certificates are missing, Caddy restart can fail even after a
successful DB import. Keep the production portal offline until PKI is fixed.

## Automated no-database checks

```bash
bash Enterprise/tests/Test-MySQL-Backup-Restore.sh
```

This test stubs Docker; it checks backup publication, restore confirmation,
malformed-file rejection, safety backup and failure behavior. GitHub Actions
runs it in `.github/workflows/deployment-safety.yml`. A real Docker/MySQL
migration, backup/restore rehearsal and Windows/Hostinger acceptance are
still separate required release gates.
