#!/usr/bin/env bash
# Stage N14: offline configuration validation ONLY. No deployment/signing.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HERE/.env"
RELEASE=0
say() { printf '[stage14-preflight] %s\n' "$*"; }
fail() { printf '[stage14-preflight][BLOCKED] %s\n' "$*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) [ "$#" -ge 2 ] || fail 'Missing --env-file path'; ENV_FILE="$2"; shift 2 ;;
    --release) RELEASE=1; shift ;;
    --help|-h) echo 'Usage: preflight-stage14.sh [--env-file PATH] [--release]'; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
[ -f "$ENV_FILE" ] || fail 'Private .env file does not exist'
command -v awk >/dev/null || fail 'awk not available'
command -v stat >/dev/null || fail 'stat not available'
perms="$(stat -c '%a' "$ENV_FILE")" || fail 'Cannot inspect .env permissions'
# Private secrets must not be group/world readable.
[ $((8#$perms & 0077)) -eq 0 ] || fail 'Private .env is too permissive (chmod 600)'
# Read as literal key/value. NEVER source an untrusted environment file.
get() { awk -v key="$1" 'index($0,key"=")==1 {print substr($0,length(key)+2);exit}' "$ENV_FILE"; }
one() {
  local count
  count="$(awk -v key="$1" 'index($0,key"=")==1{n++}END{print n+0}' "$ENV_FILE")"
  [ "$count" -eq 1 ] || fail "Expected exactly one $1 key (found $count)"
}
for key in MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD MYSQL_ROOT_PASSWORD API_TOKEN JWT_SECRET \
  BOOTSTRAP_SECRET HMAC_SECRET COMMAND_SIGNING_KEY SETUP_TOKEN SERVER_HOST CADDY_HOST; do
  one "$key"
  [ -n "$(get "$key")" ] || fail "Required $key is missing"
done
for key in MYSQL_DATABASE MYSQL_USER; do
  value="$(get "$key")"
  [[ "$value" =~ ^[A-Za-z0-9_]+$ ]] || fail "Invalid $key identifier"
done
seen=$'\n'
for key in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD API_TOKEN JWT_SECRET \
  BOOTSTRAP_SECRET HMAC_SECRET COMMAND_SIGNING_KEY SETUP_TOKEN; do
  value="$(get "$key")"
  length="$(printf '%s' "$value" | wc -c)"
  [ "$length" -ge 32 ] || fail "Weak $key: must be at least 32 characters"
  case "$value" in
    *CHANGE-ME*|*change-me*|*placeholder*|your-*) fail "Placeholder secret detected for $key" ;;
  esac
  [[ "$seen" != *$'\n'"$value"$'\n'* ]] || fail 'Two credentials reuse the same secret'
  seen="$seen$value"$'\n'
done
host="$(get SERVER_HOST)"
caddy="$(get CADDY_HOST)"
[ "$host" = "$caddy" ] || fail 'SERVER_HOST and CADDY_HOST must match'
[ "$(printf '%s' "$host" | wc -c)" -le 253 ] || fail 'DNS hostname too long'
[[ "$host" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$ ]] ||
  fail 'SERVER_HOST must be a public DNS hostname, not IP, URL or localhost'
case "$host" in
  *.local|*.localhost|*.test|*.example|*.invalid) fail 'Placeholder/local domain cannot pass preflight' ;;
esac
printf '%s' "$host" | awk -F. '{for(i=1;i<=NF;i++) if(length($i)>63) exit 1}' ||
  fail 'DNS label longer than 63 characters'
admin="$(get PLATFORM_ADMIN_USER_ID)"
owner="$(get PLATFORM_OWNER_TENANT_ID)"
if [ -n "$admin" ] || [ -n "$owner" ] || [ "$RELEASE" -eq 1 ]; then
  [[ "$admin" =~ ^[1-9][0-9]*$ ]] || fail 'Set persistent PLATFORM_ADMIN_USER_ID'
  [[ "$owner" =~ ^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$ ]] ||
    fail 'Set PLATFORM_OWNER_TENANT_ID to operator workspace UUID'
fi
if [ "$RELEASE" -eq 1 ]; then
  sha="$(get APPROVED_MSI_SHA256)"
  [[ "$sha" =~ ^[0-9a-fA-F]{64}$ ]] ||
    fail 'Signed release requires separately verified APPROVED_MSI_SHA256'
  say 'CONFIG_READY_FOR_EXTERNAL_RELEASE_REVIEW (NOT Authenticode verification)'
else
  say 'CONFIG_READY_FOR_EXTERNAL_DEPLOYMENT_REVIEW (NOT live HTTPS verification)'
fi
say 'No files, containers, public endpoints or credentials were changed.'
