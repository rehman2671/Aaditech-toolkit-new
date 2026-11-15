#!/usr/bin/env bash
# Offline smoke tests. Fake Docker exercises safety controls without touching a DB.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bash -n "$ROOT/Enterprise/deploy/backup.sh"
bash -n "$ROOT/Enterprise/deploy/restore.sh"

TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/Enterprise/deploy" "$TEMP/bin"
cp "$ROOT/Enterprise/deploy/backup.sh" "$ROOT/Enterprise/deploy/restore.sh" "$TEMP/Enterprise/deploy/"
cat > "$TEMP/Enterprise/docker-compose.yml" <<'EOF'
services:
  db:
    image: mysql:8.0
EOF
cat > "$TEMP/Enterprise/.env" <<'EOF'
MYSQL_DATABASE=it_toolkit
MYSQL_USER=itk_user
MYSQL_PASSWORD=only-a-fake-test-secret
EOF
export FAKE_DOCKER_LOG="$TEMP/docker.log"
: > "$FAKE_DOCKER_LOG"
cat > "$TEMP/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
command_text="$*"
if [[ "$command_text" == *mysqldump* ]]; then
  if [ "${FAKE_DUMP_FAIL:-0}" = 1 ]; then exit 18; fi
  printf '%s\n' '-- MySQL dump 10.13 Distrib 8.0' \
    '-- Host: localhost    Database: it_toolkit' \
    'CREATE TABLE example (id INT);' \
    'INSERT INTO example VALUES (1);' \
    "-- fixture padding $(printf '%0300d' 0)" \
    '-- Dump completed on 2026-11-15 12:00:00'
elif [[ "$command_text" == *'--binary-mode=1'* ]]; then
  cat > /dev/null
  if [ "${FAKE_IMPORT_FAIL:-0}" = 1 ]; then exit 19; fi
elif [[ "$command_text" == *'SELECT COUNT('* ]]; then
  printf '1\n'
fi
FAKE
chmod +x "$TEMP/bin/docker"
export PATH="$TEMP/bin:$PATH"
BACKUP="$TEMP/Enterprise/deploy/backup.sh"
RESTORE="$TEMP/Enterprise/deploy/restore.sh"
BACKUP_DIR="$TEMP/Enterprise/deploy/backups"

# Bad retention input must be rejected before attempting Docker actions.
if BACKUP_KEEP=not-a-number bash "$BACKUP" > "$TEMP/out" 2>&1; then
  echo "Expected invalid BACKUP_KEEP failure" >&2; exit 1
fi

bash "$BACKUP"
shopt -s nullglob
files=("$BACKUP_DIR"/ittoolkit-*.sql)
shopt -u nullglob
[ "${#files[@]}" -eq 1 ] || { echo "Missing backup output" >&2; exit 1; }
FILE="${files[0]}"
[ "$(head -n 1 "$FILE")" = '-- aaditech-mysql-backup-v1 database=it_toolkit' ]
[ "$(stat -c %a "$FILE")" = 600 ]

# Retention must prune only previous backups, keeping the current dump.
BACKUP_KEEP=1 bash "$BACKUP"
shopt -s nullglob
retained=("$BACKUP_DIR"/ittoolkit-*.sql)
shopt -u nullglob
[ "${#retained[@]}" -eq 1 ] || { echo "BACKUP_KEEP did not prune old backups" >&2; exit 1; }
FILE="${retained[0]}"

# Restore needs explicit authorization, even when a valid backup exists.
: > "$FAKE_DOCKER_LOG"
if bash "$RESTORE" "$FILE" > "$TEMP/out" 2>&1; then
  echo "Restore without --yes was allowed" >&2; exit 1
fi
[ ! -s "$FAKE_DOCKER_LOG" ] || { echo "Unauthorized restore touched Docker" >&2; exit 1; }

printf 'bad backup\n' > "$TEMP/bad.sql"
if bash "$RESTORE" --yes "$TEMP/bad.sql" > "$TEMP/out" 2>&1; then
  echo "Malformed backup was accepted" >&2; exit 1
fi
[ ! -s "$FAKE_DOCKER_LOG" ] || { echo "Malformed backup touched Docker" >&2; exit 1; }

bash "$RESTORE" --yes "$FILE"
grep -q 'stop caddy api' "$FAKE_DOCKER_LOG"
grep -q 'DROP DATABASE' "$FAKE_DOCKER_LOG"
grep -q -- '--binary-mode=1' "$FAKE_DOCKER_LOG"

# Failed import must return nonzero and leave application services stopped.
: > "$FAKE_DOCKER_LOG"
if FAKE_IMPORT_FAIL=1 bash "$RESTORE" --yes "$FILE" > "$TEMP/out" 2>&1; then
  echo "Failed import was reported as success" >&2; exit 1
fi
tail -n 1 "$FAKE_DOCKER_LOG" | grep -q 'stop caddy api' || {
  echo "Failed import did not stop application services" >&2; exit 1;
}

# Failed dump must not leave a published backup file.
before=$(find "$BACKUP_DIR" -maxdepth 1 -name 'ittoolkit-*.sql' | wc -l)
if FAKE_DUMP_FAIL=1 bash "$BACKUP" > "$TEMP/out" 2>&1; then
  echo "Failed dump was reported as success" >&2; exit 1
fi
after=$(find "$BACKUP_DIR" -maxdepth 1 -name 'ittoolkit-*.sql' | wc -l)
[ "$before" -eq "$after" ] || { echo "Failed dump published a file" >&2; exit 1; }

echo "MySQL backup/restore offline safety tests passed."
