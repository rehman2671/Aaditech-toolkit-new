#!/usr/bin/env bash
# Production migration rehearsal against disposable CI-only MySQL schema.
# Never invoke on a real deployment: requires the isolated-ci marker.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HERE/.env"
[ "$AADITECH_REHEARSAL" = 'isolated-ci' ] ||
  { echo '[legacy-live][ERROR] isolated CI marker required' >&2; exit 2; }
[ -f "$ENV_FILE" ] || exit 2
grep -q '^MYSQL_DATABASE=it_toolkit_rehearsal$' "$ENV_FILE" ||
  { echo '[legacy-live][ERROR] isolated disposable database required' >&2; exit 2; }
compose() { docker compose --env-file "$ENV_FILE" -f "$HERE/docker-compose.yml" "$@"; }
sql() {
  compose exec -T db sh -ec '
    export MYSQL_PWD="$MYSQL_PASSWORD"
    exec mysql --host=localhost --user="$MYSQL_USER" \
      --database="$MYSQL_DATABASE" --batch --skip-column-names --raw
  ' <<< "$1"
}

compose up -d --wait --wait-timeout 120 db >/dev/null
# Fixture uses fake credentials only; never real device enrollment tokens.
sql "
INSERT INTO msi_packages
(id, tenant_id, package_name, version, bootstrap_token,
 bootstrap_token_hash, token_expires_at, used)
VALUES
('n12_ci_good', '00000000-0000-0000-0000-000000000001',
 'legacy-test', '1.1.2', 'ci-legacy-good',
 SHA2('ci-legacy-good',256), DATE_ADD(NOW(), INTERVAL 1 DAY), 0),
('n12_ci_hashless', '00000000-0000-0000-0000-000000000001',
 'legacy-test', '1.1.2', 'ci-legacy-hashless',
 NULL, DATE_ADD(NOW(), INTERVAL 1 DAY), 0),
('n12_ci_mismatch', '00000000-0000-0000-0000-000000000001',
 'legacy-test', '1.1.2', 'ci-legacy-conflicting',
 REPEAT('f',64), DATE_ADD(NOW(), INTERVAL 1 DAY), 0);
INSERT INTO used_bootstrap_tokens
(token_hash, token, device_hostname, tenant_id)
VALUES (SHA2('ci-redeemed-secret',256), 'ci-redeemed-secret',
 'CI-WINDOWS', '00000000-0000-0000-0000-000000000001');
" >/dev/null

migrate="$HERE/deploy/migrate-legacy-msi-bootstrap.sh"
bash "$migrate" --audit >/dev/null
[ "$(sql "SELECT COUNT(*) FROM msi_packages WHERE id LIKE 'n12_ci_%' AND bootstrap_token IS NOT NULL;")" = 3 ] ||
  { echo '[legacy-live][ERROR] audit mutated credential rows' >&2; exit 1; }

# Existing mismatched hashes must cause hard refusal, not a rewrite.
if bash "$migrate" --apply --confirm HASH_ONLY >/dev/null 2>&1; then
  echo '[legacy-live][ERROR] mismatch was incorrectly accepted' >&2
  exit 1
fi
[ "$(sql "SELECT COUNT(*) FROM msi_packages WHERE id = 'n12_ci_mismatch' AND bootstrap_token IS NOT NULL;")" = 1 ] ||
  { echo '[legacy-live][ERROR] rejection mutated a mismatched row' >&2; exit 1; }

# Delete only our disposable bad fixture; production operator must
# manually review such conflicting legacy rows before applying migration.
sql "DELETE FROM msi_packages WHERE id = 'n12_ci_mismatch';" >/dev/null
bash "$migrate" --apply --confirm HASH_ONLY >/dev/null

remaining="$(sql "
SELECT
 (SELECT COUNT(*) FROM msi_packages WHERE bootstrap_token IS NOT NULL)
 + (SELECT COUNT(*) FROM used_bootstrap_tokens WHERE token IS NOT NULL);
")"
[ "$remaining" = 0 ] ||
  { echo "[legacy-live][ERROR] $remaining plaintext rows survive" >&2; exit 1; }
verified="$(sql "
SELECT COUNT(*) FROM msi_packages
WHERE id IN ('n12_ci_good','n12_ci_hashless')
 AND bootstrap_token IS NULL
 AND bootstrap_token_hash = CASE WHEN id = 'n12_ci_good'
      THEN SHA2('ci-legacy-good',256)
      ELSE SHA2('ci-legacy-hashless',256) END;
")"
[ "$verified" = 2 ] ||
  { echo '[legacy-live][ERROR] credential hashes not preserved correctly' >&2; exit 1; }
echo '[legacy-live] Verified read-only audit, mismatch refusal, checksum-backed backup, hash-only update and used-token redaction.'
