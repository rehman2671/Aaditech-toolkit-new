#!/usr/bin/env bash
# Create a transactionally consistent, host-side MySQL 8 backup.
# Usage: ./backup.sh                       # retain all dated .sql files
#        BACKUP_KEEP=7 ./backup.sh          # retain seven newest files
#
# Backups live outside Docker volumes. Test restore on a separate environment
# before relying on them for disaster recovery.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HERE/.env"
COMPOSE_FILE="$HERE/docker-compose.yml"
BACKUP_DIR="$HERE/deploy/backups"
BACKUP_KEEP="${BACKUP_KEEP:-0}"

log() { printf '[backup] %s\n' "$*"; }
die() { printf '[backup][ERROR] %s\n' "$*" >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE. Configure the deployment first."
[ -f "$COMPOSE_FILE" ] || die "Missing $COMPOSE_FILE."
grep -Eq '^[[:space:]]*image:[[:space:]]*mysql:' "$COMPOSE_FILE" || die "This script only supports the MySQL Docker Compose database service."
command -v docker >/dev/null 2>&1 || die "Docker is required."
[[ "$BACKUP_KEEP" =~ ^[0-9]+$ ]] || die "BACKUP_KEEP must be a non-negative integer."

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
DB_NAME="${MYSQL_DATABASE:-it_toolkit}"
DB_USER="${MYSQL_USER:-itk_user}"
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || die "Invalid MYSQL_DATABASE name."
[ -n "$DB_USER" ] && [ -n "${MYSQL_PASSWORD:-}" ] || die "MYSQL_USER/MYSQL_PASSWORD must be configured."

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
FILE="$BACKUP_DIR/ittoolkit-$STAMP.sql"
TEMP_FILE="$(mktemp "$BACKUP_DIR/.ittoolkit-XXXXXXXX.tmp")"
trap 'rm -f "$TEMP_FILE"' EXIT

log "Waiting for MySQL database readiness."
compose up -d --wait --wait-timeout 120 db >&2

# Keep mysqldump credentials inside the DB container; do not place them on
# the host process command line. Single-transaction gives a consistent InnoDB
# snapshot without table locks; schema changes must be paused during the dump.
printf '%s\n' "-- aaditech-mysql-backup-v1 database=$DB_NAME" > "$TEMP_FILE"
compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  exec mysqldump --host=localhost --user="$MYSQL_USER" \
    --single-transaction --quick --triggers --routines --events \
    --set-gtid-purged=OFF --no-tablespaces \
    --default-character-set=utf8mb4 "$MYSQL_DATABASE"
' >> "$TEMP_FILE"

[ "$(wc -c < "$TEMP_FILE")" -gt 256 ] || die "Dump is unexpectedly small; refusing to publish it."
grep -q '^-- MySQL dump' "$TEMP_FILE" || die "Invalid MySQL dump header; refusing to publish it."
chmod 600 "$TEMP_FILE"
[ ! -e "$FILE" ] || die "Backup destination already exists: $FILE"
mv "$TEMP_FILE" "$FILE"
log "Saved $FILE ($(wc -c < "$FILE" | tr -d ' ') bytes)."

# Backup filenames are date-prefixed, so lexical order is chronological.
if [ "$BACKUP_KEEP" -gt 0 ]; then
  shopt -s nullglob
  files=("$BACKUP_DIR"/ittoolkit-*.sql)
  shopt -u nullglob
  remove_count=$(("${#files[@]}" - BACKUP_KEEP))
  if [ "$remove_count" -gt 0 ]; then
    for ((i=0; i<remove_count; i++)); do
      rm -- "${files[i]}"
      log "Pruned ${files[i]}"
    done
  fi
fi
log "Backup complete. Store an encrypted copy off-host."
