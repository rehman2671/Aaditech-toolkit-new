#!/usr/bin/env bash
# Stage N12: audit then migrate historic plaintext MSI bootstrap secrets.
# Hash-only transformation preserves matching SHA-256 credential references.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HERE/.env"
COMPOSE_FILE="$HERE/docker-compose.yml"
BACKUP_DIR="$HERE/deploy/backups"
MODE=audit
CONFIRM=""
fail() { printf '[legacy-msi][ERROR] %s\n' "$*" >&2; exit 1; }
log() { printf '[legacy-msi] %s\n' "$*"; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
mysql_query() {
  compose exec -T db sh -ec '
    export MYSQL_PWD="$MYSQL_PASSWORD"
    exec mysql --host=localhost --user="$MYSQL_USER" \
      --database="$MYSQL_DATABASE" --batch --skip-column-names --raw
  ' <<< "$1"
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --audit) MODE=audit; shift ;;
    --apply) MODE=apply; shift ;;
    --confirm)
      [ "$#" -ge 2 ] || fail '--confirm requires a value'
      CONFIRM="$2"; shift 2 ;;
    --help|-h) echo 'Usage: migrate-legacy-msi-bootstrap.sh [--audit | --apply --confirm HASH_ONLY]'; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
[ "$MODE" != apply ] || [ "$CONFIRM" = HASH_ONLY ] || fail 'Apply requires --confirm HASH_ONLY'
[ -f "$ENV_FILE" ] && [ -f "$COMPOSE_FILE" ] || fail 'Enterprise/.env and Docker Compose required'
command -v docker >/dev/null 2>&1 || fail 'Docker required'
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum required'
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
DB_NAME="$MYSQL_DATABASE"
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || fail 'Invalid MYSQL_DATABASE'
[ -n "$MYSQL_USER" ] && [ -n "$MYSQL_PASSWORD" ] || fail 'MySQL credentials required'

compose up -d --wait --wait-timeout 120 db >/dev/null
# Aggregate counts only; no tokens are printed.
sql_counts='SELECT COUNT(*),
 COALESCE(SUM(bootstrap_token_hash IS NOT NULL AND
   bootstrap_token_hash <> SHA2(TRIM(bootstrap_token),256)),0),
 COALESCE(SUM(BINARY bootstrap_token <> BINARY TRIM(bootstrap_token)),0)
 FROM msi_packages WHERE bootstrap_token IS NOT NULL;'
read -r total mismatched whitespace <<< "$(mysql_query "$sql_counts" | tr '\t' ' ')"
[[ "$total" =~ ^[0-9]+$ && "$mismatched" =~ ^[0-9]+$ && "$whitespace" =~ ^[0-9]+$ ]] ||
  fail 'Unable to inspect legacy MSI rows'
used_plaintext="$(mysql_query 'SELECT COUNT(*) FROM used_bootstrap_tokens WHERE token IS NOT NULL;')"
[[ "$used_plaintext" =~ ^[0-9]+$ ]] || fail 'Unable to audit redeemed bootstrap credentials'
log "Legacy MSI plaintext=$total, hash mismatches=$mismatched, whitespace anomalies=$whitespace, used-token plaintext=$used_plaintext"
if [ "$MODE" = audit ]; then
  log 'Read-only audit: no rows changed.'
  exit 0
fi
[ "$mismatched" -eq 0 ] && [ "$whitespace" -eq 0 ] ||
  fail 'Legacy credentials require manual review; no mutation performed'
[ "$total" -gt 0 ] || [ "$used_plaintext" -gt 0 ] || { log 'Already hash-only; nothing to modify.'; exit 0; }
log 'Creating mandatory pre-migration MySQL backup.'
BACKUP_KEEP=0 bash "$HERE/deploy/backup.sh"
backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ittoolkit-*.sql' | sort | tail -n 1)"
[ -n "$backup" ] && [ -f "$backup.sha256" ] || fail 'Pre-migration backup/checksum missing'
( cd "$BACKUP_DIR" && sha256sum --check --status -- "$(basename "$backup").sha256" ) ||
  fail 'Pre-migration backup digest invalid'
[ "$(head -n 1 "$backup")" = "-- aaditech-mysql-backup-v1 database=$DB_NAME" ] ||
  fail 'Backup database header mismatch'
grep -q '^-- Dump completed on ' "$backup" || fail 'Backup incomplete'
log 'Backup verified; applying atomic hash-only token cleanup.'
# Existing matching hashes are preserved, plaintext-only rows gain SHA-256.
# Inconsistent rows are never rewritten.
mysql_query "
START TRANSACTION;
UPDATE msi_packages
 SET bootstrap_token_hash = COALESCE(bootstrap_token_hash, SHA2(TRIM(bootstrap_token),256)),
     bootstrap_token = NULL
 WHERE bootstrap_token IS NOT NULL
   AND (bootstrap_token_hash IS NULL OR bootstrap_token_hash = SHA2(TRIM(bootstrap_token),256))
   AND BINARY bootstrap_token = BINARY TRIM(bootstrap_token);
UPDATE used_bootstrap_tokens SET token = NULL WHERE token IS NOT NULL;
COMMIT;
" >/dev/null
read -r remaining x y <<< "$(mysql_query "$sql_counts" | tr '\t' ' ')"
[ "$remaining" = 0 ] || fail "Cleanup incomplete: $remaining MSI plaintext rows remain"
used_remaining="$(mysql_query 'SELECT COUNT(*) FROM used_bootstrap_tokens WHERE token IS NOT NULL;')"
[ "$used_remaining" = 0 ] || fail "Cleanup incomplete: $used_remaining used-token plaintext rows remain"
log "Legacy MSI and used-token plaintext erased. Verified recovery backup: $backup"
