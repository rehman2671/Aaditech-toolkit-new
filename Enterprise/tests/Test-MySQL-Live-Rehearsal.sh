#!/usr/bin/env bash
# Destructive integration rehearsal. Run ONLY against an isolated disposable
# MySQL Docker Compose project, never against a production .env or volume.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HERE/.env"
compose() { docker compose --env-file "$ENV_FILE" -f "$HERE/docker-compose.yml" "$@"; }

[ "${AADITECH_REHEARSAL:-}" = "isolated-ci" ] || {
  echo '[rehearsal][ERROR] AADITECH_REHEARSAL=isolated-ci required.' >&2; exit 2;
}
[ -f "$ENV_FILE" ] || { echo 'Missing Enterprise/.env' >&2; exit 2; }
grep -q '^MYSQL_DATABASE=it_toolkit_rehearsal$' "$ENV_FILE" || {
  echo '[rehearsal][ERROR] This script requires MYSQL_DATABASE=it_toolkit_rehearsal.' >&2; exit 2;
}

compose up -d --wait --wait-timeout 180 db
compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --execute="
    CREATE TABLE IF NOT EXISTS rehearsal_marker (
      id INT PRIMARY KEY,
      content VARCHAR(64) NOT NULL
    );
    INSERT INTO rehearsal_marker (id, content) VALUES (1, '\''before'\'')
    ON DUPLICATE KEY UPDATE content = VALUES(content);
  "
'

bash "$HERE/deploy/backup.sh"
shopt -s nullglob
backups=("$HERE"/deploy/backups/ittoolkit-*.sql)
shopt -u nullglob
[ "${#backups[@]}" -ge 1 ] || { echo 'Backup not created' >&2; exit 1; }
snapshot="${backups[${#backups[@]}-1]}"

compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" \
    --execute="UPDATE rehearsal_marker SET content = '\''after'\'' WHERE id = 1;"
'

# This is a disposable database and the --db-only flag deliberately leaves
# the API and Caddy OFF after data recovery.
bash "$HERE/deploy/restore.sh" --yes --db-only "$snapshot"

value="$(compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --batch --skip-column-names \
    --execute="SELECT content FROM rehearsal_marker WHERE id = 1;"
')"
[ "$value" = 'before' ] || {
  echo "[rehearsal][ERROR] Restore returned unexpected marker: $value" >&2
  exit 1
}

shopt -s nullglob
backups=("$HERE"/deploy/backups/ittoolkit-*.sql)
shopt -u nullglob
[ "${#backups[@]}" -ge 2 ] || {
  echo '[rehearsal][ERROR] Safety backup was not created before restore.' >&2; exit 1;
}
echo '[rehearsal] MySQL backup, mutation, restore and safety backup verified.'
