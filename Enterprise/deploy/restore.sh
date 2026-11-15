#!/usr/bin/env bash
# Restore a MySQL backup created by Enterprise/deploy/backup.sh.
# Destructive by design: explicit --yes approval is required.
#
#   ./restore.sh --yes                              # newest backup
#   ./restore.sh --yes /path/to/ittoolkit-*.sql     # specified backup
#   ./restore.sh --yes --db-only /path/to/backup.sql  # isolated rehearsal; leaves API/Caddy stopped
#
# The script stops application writers, saves an independent safety backup,
# replaces the configured database, verifies connectivity, then restarts the
# application. If anything fails, application services stay stopped.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HERE/.env"
COMPOSE_FILE="$HERE/docker-compose.yml"
BACKUP_DIR="$HERE/deploy/backups"

log() { printf '[restore] %s\n' "$*"; }
die() { printf '[restore][ERROR] %s\n' "$*" >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

CONFIRMED=0
DB_ONLY=0
FILE=""
for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRMED=1 ;;
    --db-only) DB_ONLY=1 ;;
    --help|-h)
      echo "Usage: $0 --yes [--db-only] [path/to/ittoolkit-*.sql]"
      exit 0 ;;
    -*) die "Unknown option: $arg" ;;
    *) [ -z "$FILE" ] || die "Supply at most one backup file."; FILE="$arg" ;;
  esac
done
[ "$CONFIRMED" -eq 1 ] || die "Restore replaces database contents. Rerun with --yes to authorize."
[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE."
[ -f "$COMPOSE_FILE" ] || die "Missing $COMPOSE_FILE."
grep -Eq '^[[:space:]]*image:[[:space:]]*mysql:' "$COMPOSE_FILE" || die "This script only supports MySQL Docker Compose."
command -v docker >/dev/null 2>&1 || die "Docker is required."

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
DB_NAME="${MYSQL_DATABASE:-it_toolkit}"
DB_USER="${MYSQL_USER:-itk_user}"
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || die "Invalid MYSQL_DATABASE."
[ -n "$DB_USER" ] && [ -n "${MYSQL_PASSWORD:-}" ] || die "MYSQL_USER/MYSQL_PASSWORD must be configured."

if [ -z "$FILE" ]; then
  shopt -s nullglob
  files=("$BACKUP_DIR"/ittoolkit-*.sql)
  shopt -u nullglob
  [ "${#files[@]}" -gt 0 ] || die "No .sql backups found in $BACKUP_DIR."
  FILE="${files[${#files[@]}-1]}"
fi
[ -f "$FILE" ] && [ -r "$FILE" ] || die "Backup is not a readable file: $FILE"
[ "$(head -n 1 "$FILE")" = "-- aaditech-mysql-backup-v1 database=$DB_NAME" ] || die "Backup signature or database name does not match $DB_NAME."
grep -q '^-- MySQL dump' "$FILE" || die "Not a valid MySQL dump."
grep -q '^-- Dump completed on ' "$FILE" || die "Backup is truncated (missing completion marker)."
log "Validated MySQL backup: $FILE"
log "Stopping API and Caddy to prevent writes during the restore."
STOPPED=0
on_exit() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$STOPPED" -eq 1 ]; then
    compose stop caddy api >/dev/null 2>&1 || true
    printf '%s\n' '[restore][ERROR] Restore did not complete. API/Caddy are stopped to protect the database. Inspect logs and recover from the safety backup before restarting.' >&2
  fi
}
trap on_exit EXIT
compose stop caddy api
STOPPED=1

log "Creating a separate safety backup of current data before replacement."
# CI checkouts and zip deployments do not reliably preserve executable bits.
# Invoke via bash rather than relying on chmod +x from git mode metadata.
BACKUP_KEEP=0 bash "$HERE/deploy/backup.sh"

log "Replacing database $DB_NAME (previous contents will be removed)."
# The standard MySQL image grants its MYSQL_USER full rights on MYSQL_DATABASE.
# Validate identifier before interpolating it into a SQL statement.
compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  case "$MYSQL_DATABASE" in
    ""|*[!a-zA-Z0-9_]* ) echo "Invalid MYSQL_DATABASE" >&2; exit 2 ;;
  esac
  mysql --host=127.0.0.1 --user="$MYSQL_USER" \
    --execute="DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
'
compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  exec mysql --host=127.0.0.1 --user="$MYSQL_USER" \
    --default-character-set=utf8mb4 --binary-mode=1 \
    --database="$MYSQL_DATABASE"
' < "$FILE"

compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysql --host=127.0.0.1 --user="$MYSQL_USER" \
    --database="$MYSQL_DATABASE" --batch --skip-column-names \
    --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();" |
    grep -Eq "^[1-9][0-9]*$"
'

if [ "$DB_ONLY" -eq 1 ]; then
  log "Database import verified. --db-only: API and Caddy remain stopped for isolated rehearsal."
  log "Restore successful; inspect data and explicitly start services only after acceptance."
else
  log "Database import verified. Starting API and Caddy."
  compose up -d --wait --wait-timeout 120 api caddy
  STOPPED=0
  log "Restore successful. Check application functionality and tenant data before accepting production traffic."
fi
