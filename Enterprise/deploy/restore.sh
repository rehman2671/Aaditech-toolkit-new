#!/usr/bin/env bash
# Restore a MySQL backup created by Enterprise/deploy/backup.sh.
# Destructive by design: explicit --yes approval is required.
#
#   ./restore.sh --yes                              # newest backup
#   ./restore.sh --yes /path/to/ittoolkit-*.sql     # specified backup
#   ./restore.sh --yes --db-only /path/to/backup.sql  # isolated rehearsal; leaves API/Caddy stopped
#   ./restore.sh --yes --allow-legacy-without-sha256 /trusted/older.sql  # explicit legacy override
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
source "$HERE/deploy/recovery-compose-env.sh"
compose() { recovery_compose "$@"; }
trap recovery_cleanup EXIT

CONFIRMED=0
DB_ONLY=0
ALLOW_LEGACY=0
FILE=""
for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRMED=1 ;;
    --db-only) DB_ONLY=1 ;;
    --allow-legacy-without-sha256) ALLOW_LEGACY=1 ;;
    --help|-h)
      echo "Usage: $0 --yes [--db-only] [--allow-legacy-without-sha256] [path/to/ittoolkit-*.sql]"
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

prepare_recovery_env "$ENV_FILE" "${AADITECH_RECOVERY_EXPECTED_ENV_SHA:-}" || die "Recovery environment refused."

if [ -z "$FILE" ]; then
  shopt -s nullglob
  files=("$BACKUP_DIR"/ittoolkit-*.sql)
  shopt -u nullglob
  [ "${#files[@]}" -gt 0 ] || die "No .sql backups found in $BACKUP_DIR."
  FILE="${files[${#files[@]}-1]}"
fi
[ -f "$FILE" ] && [ -r "$FILE" ] || die "Backup is not a readable file: $FILE"
# Import only the privately staged bytes that were actually validated.
# The operator-supplied path can be replaced while the safety backup runs.
SOURCE_FILE="$FILE"
STAGE_DIR="$(mktemp -d)"
chmod 700 "$STAGE_DIR"
trap 'rm -rf -- "$STAGE_DIR"; recovery_cleanup' EXIT
FILE="$STAGE_DIR/$(basename "$SOURCE_FILE")"
cp -- "$SOURCE_FILE" "$FILE"
chmod 600 "$FILE"
if [ -e "$SOURCE_FILE.sha256" ] || [ -L "$SOURCE_FILE.sha256" ]; then
  [ -f "$SOURCE_FILE.sha256" ] && [ -r "$SOURCE_FILE.sha256" ] || die "Backup SHA-256 sidecar is not readable."
  cp -- "$SOURCE_FILE.sha256" "$FILE.sha256"
  chmod 600 "$FILE.sha256"
fi
# Validate bytes BEFORE stopping any service or dropping a database. SHA-256
# detects damaged/incomplete backups, not malicious re-signing by an attacker.
# The override permits explicitly reviewed old dumps with no digest sidecar;
# a PRESENT BUT INVALID sidecar is always fatal, even with that override.
if [ -e "$FILE.sha256" ]; then
  [ -f "$FILE.sha256" ] && [ -r "$FILE.sha256" ] || die "Backup SHA-256 sidecar is not readable."
  command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required."
  line="$(cat "$FILE.sha256")"
  [[ "$line" =~ ^([a-f0-9]{64})[[:space:]][[:space:]]([A-Za-z0-9._-]+)$ ]] ||
    die "Malformed SHA-256 backup sidecar."
  expected_hash="${BASH_REMATCH[1]}"
  expected_name="${BASH_REMATCH[2]}"
  [ "$expected_name" = "$(basename "$FILE")" ] || die "SHA-256 sidecar references the wrong backup."
  actual="$(sha256sum -- "$FILE")"
  actual="${actual%% *}"
  [ "$actual" = "$expected_hash" ] || die "Backup SHA-256 mismatch: restore aborted before shutdown."
elif [ "$ALLOW_LEGACY" -ne 1 ]; then
  die "Missing SHA-256 backup sidecar. For an independently reviewed legacy dump only, explicitly use --allow-legacy-without-sha256."
else
  log "WARNING: explicit legacy backup without SHA-256 accepted by operator; check trusted origin independently."
fi
[ "$(head -n 1 "$FILE")" = "-- aaditech-mysql-backup-v1 database=$DB_NAME" ] || die "Backup signature or database name does not match $DB_NAME."
grep -q '^-- MySQL dump' "$FILE" || die "Not a valid MySQL dump."
grep -q '^-- Dump completed on ' "$FILE" || die "Backup is truncated (missing completion marker)."
log "Validated staged MySQL backup from: $SOURCE_FILE"
log "Stopping API and Caddy to prevent writes during the restore."
STOPPED=0
on_exit() {
  status=$?
  rm -rf -- "$STAGE_DIR"
  if [ "$status" -ne 0 ] && [ "$STOPPED" -eq 1 ]; then
    compose stop caddy api >/dev/null 2>&1 || true
    printf '%s\n' '[restore][ERROR] Restore did not complete. API/Caddy are stopped to protect the database. Inspect logs and recover from the safety backup before restarting.' >&2
  fi
  recovery_cleanup
}
trap on_exit EXIT
compose stop caddy api
STOPPED=1

log "Creating a separate safety backup of current data before replacement."
# CI checkouts and zip deployments do not reliably preserve executable bits.
# Invoke via bash rather than relying on chmod +x from git mode metadata.
AADITECH_RECOVERY_EXPECTED_ENV_SHA="$RECOVERY_ENV_SHA" BACKUP_KEEP=0 bash "$HERE/deploy/backup.sh"

log "Replacing database $DB_NAME (previous contents will be removed)."
# The standard MySQL image grants its MYSQL_USER full rights on MYSQL_DATABASE.
# Validate identifier before interpolating it into a SQL statement.
compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  case "$MYSQL_DATABASE" in
    ""|*[!a-zA-Z0-9_]* ) echo "Invalid MYSQL_DATABASE" >&2; exit 2 ;;
  esac
  mysql --host=localhost --user="$MYSQL_USER" \
    --execute="DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
'
compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  exec mysql --host=localhost --user="$MYSQL_USER" \
    --default-character-set=utf8mb4 --binary-mode=1 \
    --database="$MYSQL_DATABASE"
' < "$FILE"

compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysql --host=localhost --user="$MYSQL_USER" \
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
