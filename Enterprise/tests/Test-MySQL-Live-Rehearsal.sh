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
[ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || {
  echo '[rehearsal][ERROR] GitHub-hosted disposable runner required.' >&2; exit 2;
}
grep -Eq '^COMPOSE_PROJECT_NAME=itk_rehearsal_[0-9]+$' "$ENV_FILE" || { echo 'Unexpected CI project' >&2; exit 2; }
grep -q '^MYSQL_DATABASE=it_toolkit_rehearsal$' "$ENV_FILE" || {
  echo '[rehearsal][ERROR] This script requires MYSQL_DATABASE=it_toolkit_rehearsal.' >&2; exit 2;
}

compose up -d --wait --wait-timeout 180 db
# MySQL's temporary initialization server may accept Unix-socket
# queries and then shut down. Require TCP to the final server (the temporary
# server uses --skip-networking) before any migration or non-idempotent seed.
# Retry only the idempotent initial marker; do not retry ambiguous commits.
initialized=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if compose exec -T db sh -ec '
      export MYSQL_PWD="$MYSQL_PASSWORD"
      mysql --protocol=TCP --host=127.0.0.1 --connect-timeout=3 --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --execute="
        CREATE TABLE IF NOT EXISTS rehearsal_marker (
          id INT PRIMARY KEY,
          content VARCHAR(64) NOT NULL
        );
        INSERT INTO rehearsal_marker (id, content) VALUES (1, '\''before'\'')
        ON DUPLICATE KEY UPDATE content = VALUES(content);
      "
    ' >/dev/null 2>&1; then
    initialized=1
    break
  fi
  sleep 2
done
[ "$initialized" -eq 1 ] || {
  echo '[rehearsal][ERROR] MySQL test fixture was not ready after retries.' >&2
  exit 1
}

# Exercise the actual Phase O security tables, not only a generic marker.
# These are synthetic values in the disposable CI database; no live tokens.
sql() {
  compose exec -T db sh -ec '
    export MYSQL_PWD="$MYSQL_PASSWORD"
    exec mysql --protocol=TCP --host=127.0.0.1 --connect-timeout=3 --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --batch --skip-column-names
  '
}
# Require an additional successful final-server probe before seeding.
sql <<< 'SELECT 1' >/dev/null
for migration in 016_app_usage_snapshot.sql 017_device_recovery_reviews.sql 018_troubleshooting_incidents.sql 019_troubleshooting_diagnostic_plans.sql 021_installation_database_identity.sql; do
  sql < "$HERE/../database/migrations/$migration"
done
identity_dir="$(mktemp -d)"
chmod 700 "$identity_dir"
encrypted_stage=''
trap 'rm -rf -- "$identity_dir"; if [ -n "$encrypted_stage" ]; then rm -rf -- "$encrypted_stage"; fi' EXIT
printf '%s\n' '{"schema_version":1,"installation_id":"00000000-0000-4000-8000-000000009021"}' > "$identity_dir/installation-identity.json"
chmod 600 "$identity_dir/installation-identity.json"
identity_hash="$(sha256sum -- "$identity_dir/installation-identity.json" | cut -d ' ' -f1)"
[[ "$identity_hash" =~ ^[a-f0-9]{64}$ ]] || exit 1
sql <<< "INSERT INTO installation_database_identity(singleton_id,installation_id,identity_sha256) VALUES(1,'00000000-0000-4000-8000-000000009021','$identity_hash');"
verify_identity() {
  local actual
  actual="$(sql <<< 'SELECT CONCAT(singleton_id,CHAR(58),installation_id,CHAR(58),identity_sha256) FROM installation_database_identity;')"
  [ "$actual" = "1:00000000-0000-4000-8000-000000009021:$identity_hash" ] || { echo 'Installation identity mismatch' >&2; return 1; }
  [ "$(sha256sum -- "$identity_dir/installation-identity.json" | cut -d ' ' -f1)" = "$identity_hash" ]
}
verify_identity
sql <<'SQL'
START TRANSACTION;
INSERT INTO tenants (id,name,slug) VALUES ('00000000-0000-4000-8000-000000009016','CI restore fixture','ci-restore-fixture');
INSERT INTO devices (id,tenant_id,hostname,device_token_hash,agent_token_revoked)
VALUES ('00000000-0000-4000-8000-000000009017','00000000-0000-4000-8000-000000009016','CI-RESTORE',REPEAT('a',64),1);
INSERT INTO telemetry_batches (tenant_id,device_id,batch_id,request_hash,insert_nonce,accepted_count,recorded_at)
VALUES ('00000000-0000-4000-8000-000000009016','00000000-0000-4000-8000-000000009017','restore-batch',REPEAT('b',64),REPEAT('c',32),2,'2026-01-01 00:00:00.123');
INSERT INTO device_app_usage_snapshots (device_id,tenant_id,credential_fingerprint,payload_json,recorded_at)
VALUES ('00000000-0000-4000-8000-000000009017','00000000-0000-4000-8000-000000009016',REPEAT('d',64),JSON_ARRAY(JSON_OBJECT('name','CI fixture','seconds',12)),'2026-01-01 00:00:00.123');
INSERT INTO device_recovery_reviews (request_id,tenant_id,device_id,requester_id,reviewer_id,challenge_sha256,credential_fingerprint,evidence_sha256,reviewer_spki_sha256,state,created_at_ms,expires_at_ms,reviewed_at_ms,review_expires_at_ms)
VALUES ('00000000-0000-4000-8000-000000009018','00000000-0000-4000-8000-000000009016','00000000-0000-4000-8000-000000009017',11,12,REPEAT('e',64),REPEAT('f',64),REPEAT('1',64),REPEAT('2',64),'REVIEW_RESERVED',1700000000000,1700000900000,1700000001000,1700000300000);
INSERT INTO troubleshooting_incidents (incident_id,installation_id,tenant_id,device_id,actor_user_id,intake_request_id,category_id,hazard,status,opened_at)
VALUES ('00000000-0000-4000-8000-000000009020','00000000-0000-4000-8000-000000009021','00000000-0000-4000-8000-000000009016','00000000-0000-4000-8000-000000009017',11,'00000000-0000-4000-8000-000000009022','TR-24','PHYSICAL_HAZARD','ESCALATED','2026-01-01 00:00:00.123');
INSERT INTO troubleshooting_incidents (incident_id,installation_id,tenant_id,device_id,actor_user_id,intake_request_id,category_id,hazard,status,opened_at)
VALUES ('00000000-0000-4000-8000-000000009024','00000000-0000-4000-8000-000000009021','00000000-0000-4000-8000-000000009016','00000000-0000-4000-8000-000000009017',11,'00000000-0000-4000-8000-000000009025','TR-01','NONE','OPEN','2026-01-01 00:00:00.123');
INSERT INTO troubleshooting_diagnostic_plans (plan_id,incident_id,installation_id,tenant_id,device_id,actor_user_id,request_id,diagnostic_id,created_at)
VALUES ('00000000-0000-4000-8000-000000009026','00000000-0000-4000-8000-000000009024','00000000-0000-4000-8000-000000009021','00000000-0000-4000-8000-000000009016','00000000-0000-4000-8000-000000009017',11,'00000000-0000-4000-8000-000000009027','RESOURCE_PRESSURE','2026-01-01 00:00:00.123');
COMMIT;
SQL
security_snapshot() {
  sql <<'SQL'
SELECT singleton_id,installation_id,identity_sha256,bound_at FROM installation_database_identity;
SELECT id,tenant_id,device_token_hash,agent_token_revoked FROM devices WHERE id='00000000-0000-4000-8000-000000009017';
SELECT tenant_id,device_id,batch_id,request_hash,insert_nonce,accepted_count,recorded_at FROM telemetry_batches WHERE batch_id='restore-batch' AND tenant_id='00000000-0000-4000-8000-000000009016';
SELECT device_id,tenant_id,credential_fingerprint,payload_json,recorded_at FROM device_app_usage_snapshots WHERE device_id='00000000-0000-4000-8000-000000009017';
SELECT request_id,tenant_id,device_id,requester_id,reviewer_id,challenge_sha256,credential_fingerprint,evidence_sha256,reviewer_spki_sha256,state,created_at_ms,expires_at_ms,reviewed_at_ms,review_expires_at_ms FROM device_recovery_reviews WHERE request_id='00000000-0000-4000-8000-000000009018';
SELECT incident_id,installation_id,tenant_id,device_id,actor_user_id,intake_request_id,category_id,hazard,status,opened_at FROM troubleshooting_incidents WHERE incident_id IN ('00000000-0000-4000-8000-000000009020','00000000-0000-4000-8000-000000009024') ORDER BY incident_id;
SELECT plan_id,incident_id,installation_id,tenant_id,device_id,actor_user_id,request_id,diagnostic_id,created_at FROM troubleshooting_diagnostic_plans WHERE plan_id='00000000-0000-4000-8000-000000009026';
SQL
}
before_security="$(security_snapshot)"
[ "$(printf '%s\n' "$before_security" | wc -l)" -eq 8 ] || { echo 'Incomplete security fixture' >&2; exit 1; }

compose stop db
compose up -d --wait --wait-timeout 180 db
ready=0
for attempt in $(seq 1 20); do
  if sql <<< 'SELECT 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" -eq 1 ] || { echo 'Persistent database restart did not become ready' >&2; exit 1; }
verify_identity
[ "$(security_snapshot)" = "$before_security" ] || { echo 'Persistent restart changed security state' >&2; exit 1; }
echo '[rehearsal] Persistent database restart preserved installation identity and security rows.'
bash "$HERE/deploy/backup.sh"
shopt -s nullglob
backups=("$HERE"/deploy/backups/ittoolkit-*.sql)
shopt -u nullglob
[ "${#backups[@]}" -ge 1 ] || { echo 'Backup not created' >&2; exit 1; }
snapshot="${backups[${#backups[@]}-1]}"
# Exercise the existing authenticated encryption reference on the actual
# disposable MySQL dump. This is not a production backup/signing workflow.
encrypted_stage="$(mktemp -d)"
chmod 700 "$encrypted_stage"
AADITECH_REHEARSAL=isolated-ci node "$HERE/tests/verify-encrypted-mysql-rehearsal.mjs" "$snapshot" "$encrypted_stage"
recovered="$encrypted_stage/$(basename "$snapshot")"
cmp "$snapshot" "$recovered"

compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" \
    --execute="UPDATE rehearsal_marker SET content = '\''after'\'' WHERE id = 1;"
'

sql <<'SQL'
START TRANSACTION;
UPDATE installation_database_identity SET identity_sha256=REPEAT('9',64) WHERE singleton_id=1;
UPDATE devices SET agent_token_revoked=0,device_token_hash=REPEAT('9',64) WHERE id='00000000-0000-4000-8000-000000009017';
DELETE FROM telemetry_batches WHERE tenant_id='00000000-0000-4000-8000-000000009016' AND batch_id='restore-batch';
DELETE FROM device_app_usage_snapshots WHERE device_id='00000000-0000-4000-8000-000000009017';
DELETE FROM device_recovery_reviews WHERE request_id='00000000-0000-4000-8000-000000009018';
DELETE FROM troubleshooting_diagnostic_plans WHERE plan_id='00000000-0000-4000-8000-000000009026';
DELETE FROM troubleshooting_incidents WHERE incident_id IN ('00000000-0000-4000-8000-000000009020','00000000-0000-4000-8000-000000009024');
COMMIT;
SQL
[ "$(security_snapshot)" != "$before_security" ] || { echo 'Security fixture mutation failed' >&2; exit 1; }
if verify_identity >/dev/null 2>&1; then echo 'Mismatched installation identity was not rejected' >&2; exit 1; fi

# This is a disposable database and the --db-only flag deliberately leaves
# the API and Caddy OFF after data recovery.
bash "$HERE/deploy/restore.sh" --yes --db-only "$recovered"
verify_identity

value="$(compose exec -T db sh -ec '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --batch --skip-column-names \
    --execute="SELECT content FROM rehearsal_marker WHERE id = 1;"
')"
[ "$value" = 'before' ] || {
  echo "[rehearsal][ERROR] Restore returned unexpected marker: $value" >&2
  exit 1
}

[ "$(security_snapshot)" = "$before_security" ] || {
  echo '[rehearsal][ERROR] Restored credential, receipt, snapshot or recovery-review state differs.' >&2; exit 1;
}
# Review challenge uniqueness must survive restore; never silently replace
# a prior reservation. A duplicate must fail, not produce a second row.
if sql >/dev/null 2>&1 <<'SQL'
INSERT INTO device_recovery_reviews (request_id,tenant_id,device_id,requester_id,challenge_sha256,credential_fingerprint,created_at_ms,expires_at_ms)
VALUES ('00000000-0000-4000-8000-000000009019','00000000-0000-4000-8000-000000009016','00000000-0000-4000-8000-000000009017',11,REPEAT('e',64),REPEAT('f',64),1700000000000,1700000900000);
SQL
then
  echo '[rehearsal][ERROR] Duplicate recovery challenge survived restore.' >&2; exit 1
fi
[ "$(security_snapshot)" = "$before_security" ] || { echo 'Security state changed after duplicate attempt' >&2; exit 1; }
# The intake idempotency key must also survive the encrypted round trip.
if sql >/dev/null 2>&1 <<'SQL'
INSERT INTO troubleshooting_incidents (incident_id,installation_id,tenant_id,device_id,actor_user_id,intake_request_id,category_id,hazard,status)
VALUES ('00000000-0000-4000-8000-000000009023','00000000-0000-4000-8000-000000009021','00000000-0000-4000-8000-000000009016','00000000-0000-4000-8000-000000009017',11,'00000000-0000-4000-8000-000000009022','TR-24','PHYSICAL_HAZARD','ESCALATED');
SQL
then
  echo '[rehearsal][ERROR] Duplicate incident intake survived restore.' >&2; exit 1
fi
[ "$(security_snapshot)" = "$before_security" ] || { echo 'Incident state changed after duplicate attempt' >&2; exit 1; }
if sql >/dev/null 2>&1 <<'SQL'
INSERT INTO troubleshooting_diagnostic_plans (plan_id,incident_id,installation_id,tenant_id,device_id,actor_user_id,request_id,diagnostic_id)
VALUES ('00000000-0000-4000-8000-000000009028','00000000-0000-4000-8000-000000009024','00000000-0000-4000-8000-000000009021','00000000-0000-4000-8000-000000009016','00000000-0000-4000-8000-000000009017',11,'00000000-0000-4000-8000-000000009027','RESOURCE_PRESSURE');
SQL
then
  echo '[rehearsal][ERROR] Duplicate diagnostic plan survived restore.' >&2; exit 1
fi
[ "$(security_snapshot)" = "$before_security" ] || { echo 'Diagnostic plan state changed after duplicate attempt' >&2; exit 1; }
if sql >/dev/null 2>&1 <<'SQL'
INSERT INTO installation_database_identity(singleton_id,installation_id,identity_sha256) VALUES(1,'00000000-0000-4000-8000-000000009099',REPEAT('8',64));
SQL
then
  echo 'Duplicate installation identity was admitted' >&2; exit 1
fi
verify_identity
[ "$(security_snapshot)" = "$before_security" ] || exit 1
echo '[rehearsal] Installation identity, credential revocation, telemetry receipt, usage snapshot, recovery reservation, incident intake and diagnostic plans preserved.'

shopt -s nullglob
backups=("$HERE"/deploy/backups/ittoolkit-*.sql)
shopt -u nullglob
[ "${#backups[@]}" -ge 2 ] || {
  echo '[rehearsal][ERROR] Safety backup was not created before restore.' >&2; exit 1;
}
echo '[rehearsal] MySQL backup, mutation, restore and safety backup verified.'
