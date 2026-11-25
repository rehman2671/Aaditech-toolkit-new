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
source "$HERE/deploy/recovery-compose-env.sh"
compose() { recovery_compose "$@"; }
trap recovery_cleanup EXIT

[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE. Configure the deployment first."
[ -f "$COMPOSE_FILE" ] || die "Missing $COMPOSE_FILE."
grep -Eq '^[[:space:]]*image:[[:space:]]*mysql:' "$COMPOSE_FILE" || die "This script only supports the MySQL Docker Compose database service."
command -v docker >/dev/null 2>&1 || die "Docker is required."
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required for backup integrity."
[[ "$BACKUP_KEEP" =~ ^(0|[1-9][0-9]{0,5})$ ]] || die "BACKUP_KEEP must be a canonical integer from 0 to 999999."

prepare_recovery_env "$ENV_FILE" "${AADITECH_RECOVERY_EXPECTED_ENV_SHA:-}" || die "Recovery environment refused."

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
FILE="$BACKUP_DIR/ittoolkit-$STAMP.sql"
TEMP_FILE="$(mktemp "$BACKUP_DIR/.ittoolkit-XXXXXXXX.tmp")"
TEMP_HASH="$(mktemp "$BACKUP_DIR/.ittoolkit-sha256-XXXXXXXX.tmp")"
trap 'rm -f "$TEMP_FILE" "$TEMP_HASH"; recovery_cleanup' EXIT

log "Waiting for MySQL database readiness."
compose up -d --wait --wait-timeout 120 db >&2

# docker health can briefly turn healthy while MySQL is still restarting.
# Probe with the actual application user AND database, not mysqladmin ping,
# before attempting a dump. Bounded retries avoid publishing partial SQL.
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if compose exec -T db sh -ec '
      export MYSQL_PWD="$MYSQL_PASSWORD"
      exec mysql --host=localhost --user="$MYSQL_USER" \
        --database="$MYSQL_DATABASE" --batch --skip-column-names \
        --execute="SELECT 1"
    ' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" -eq 1 ] || die "MySQL user/database probe did not become ready."

# Keep credentials inside the container and never write them on the host
# command line. A transient MySQL restart must not expose a partial dump as
# a successful backup; each retry overwrites its private temporary file.
dumped=0
for attempt in 1 2 3 4 5; do
  printf '%s\n' "-- aaditech-mysql-backup-v1 database=$DB_NAME" > "$TEMP_FILE"
  if compose exec -T db sh -ec '
      export MYSQL_PWD="$MYSQL_PASSWORD"
      exec mysqldump --host=localhost --user="$MYSQL_USER" \
        --single-transaction --quick --triggers --routines --events \
        --set-gtid-purged=OFF --no-tablespaces \
        --default-character-set=utf8mb4 "$MYSQL_DATABASE"
    ' >> "$TEMP_FILE"; then
    dumped=1
    break
  fi
  log "MySQL dump attempt $attempt failed; retrying after readiness check."
  sleep 2
done
[ "$dumped" -eq 1 ] || die "MySQL dump failed after five attempts."

[ "$(wc -c < "$TEMP_FILE")" -gt 256 ] || die "Dump is unexpectedly small; refusing to publish it."
grep -q '^-- MySQL dump' "$TEMP_FILE" || die "Invalid MySQL dump header; refusing to publish it."
grep -q '^-- Dump completed on ' "$TEMP_FILE" || die "Incomplete MySQL dump; refusing to publish it."
chmod 600 "$TEMP_FILE"
# Write the digest before promoting the backup. If interrupted between the two
# atomic renames, restore refuses the orphaned .sql (no approved sidecar).
digest="$(sha256sum -- "$TEMP_FILE")"
digest="${digest%% *}"
printf '%s  %s\n' "$digest" "$(basename "$FILE")" > "$TEMP_HASH"
chmod 600 "$TEMP_HASH"
[ ! -e "$FILE" ] && [ ! -e "$FILE.sha256" ] || die "Backup destination already exists: $FILE"
mv "$TEMP_FILE" "$FILE"
mv "$TEMP_HASH" "$FILE.sha256"
log "Saved $FILE ($(wc -c < "$FILE" | tr -d ' ') bytes) with matching SHA-256 sidecar."

# Backup filenames are date-prefixed, so lexical order is chronological.
if [ "$BACKUP_KEEP" -gt 0 ]; then
  shopt -s nullglob
  files=("$BACKUP_DIR"/ittoolkit-*.sql)
  shopt -u nullglob
  remove_count=$(("${#files[@]}" - BACKUP_KEEP))
  if [ "$remove_count" -gt 0 ]; then
    for ((i=0; i<remove_count; i++)); do
      # Older, explicitly retained legacy dumps may not have a sidecar.
      rm -f -- "${files[i]}" "${files[i]}.sha256"
      log "Pruned dated backup and integrity sidecar: ${files[i]}"
    done
  fi
fi
log "Backup complete. Store an encrypted copy off-host."
