#!/usr/bin/env bash
# Offline dry-run policy tests, with disposable synthetic secrets only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PREFLIGHT="$ROOT/Enterprise/deploy/preflight-stage14.sh"
bash -n "$PREFLIGHT"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
file="$tmp/.env"
{
  printf '%s\n' 'MYSQL_DATABASE=it_toolkit' 'MYSQL_USER=itk_user'
  i=1
  for key in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD API_TOKEN JWT_SECRET BOOTSTRAP_SECRET \
    HMAC_SECRET COMMAND_SIGNING_KEY SETUP_TOKEN; do
    printf '%s=%064d\n' "$key" "$i"
    i=$((i+1))
  done
  printf '%s\n' 'SERVER_HOST=console.aaditech.net' 'CADDY_HOST=console.aaditech.net'
  printf '%s\n' 'PLATFORM_ADMIN_USER_ID=81'
  printf '%s\n' 'PLATFORM_OWNER_TENANT_ID=00000000-0000-0000-0000-000000000081'
  printf '%s\n' 'APPROVED_MSI_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
} > "$file"
chmod 600 "$file"
bash "$PREFLIGHT" --env-file "$file" >/dev/null
bash "$PREFLIGHT" --env-file "$file" --release >/dev/null
fail_expected() {
  if bash "$PREFLIGHT" --env-file "$file" "$@" >/dev/null 2>&1; then
    echo '[FAIL] unsafe release/preflight configuration was accepted' >&2
    exit 1
  fi
}
# Reject disguised IP literals and reserved zones, including mixed-case DNS.
for unsafe in '127.0.0.1' '999.999.999.999' 'console.example.com' 'console.EXAMPLE.ORG' 'host.local'; do
  sed -i "s@console.aaditech.net@$unsafe@g" "$file"
  fail_expected
  sed -i "s@$unsafe@console.aaditech.net@g" "$file"
done
sed -i 's@console.aaditech.net@console.example@g' "$file"
fail_expected
sed -i 's@console.example@console.aaditech.net@g' "$file"
sed -i 's@PLATFORM_ADMIN_USER_ID=81@PLATFORM_ADMIN_USER_ID=0@g' "$file"
fail_expected --release
sed -i 's@PLATFORM_ADMIN_USER_ID=0@PLATFORM_ADMIN_USER_ID=81@g' "$file"
sed -i 's@APPROVED_MSI_SHA256=aaaa.*@APPROVED_MSI_SHA256=invalid@g' "$file"
fail_expected --release
# Config can be checked without a signed release hash, but release cannot.
bash "$PREFLIGHT" --env-file "$file" >/dev/null
sed -i 's@APPROVED_MSI_SHA256=invalid@APPROVED_MSI_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@g' "$file"
chmod 644 "$file"
fail_expected
chmod 600 "$file"
printf '%s\n' 'JWT_SECRET=duplicate' >> "$file"
fail_expected
echo '[PASS] Stage 14 offline config and signed-release controls reject unsafe inputs.'
