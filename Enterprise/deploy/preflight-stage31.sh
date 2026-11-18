#!/usr/bin/env bash
# N31 offline by default, never executes a deployment or sources .env.
set -euo pipefail
umask 077
DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE=''
REPORT_FILE=''
RELEASE=0
LIVE=0
LIVE_CONFIRM=''
say() { printf '[n31-preflight] %s\n' "$*"; }
fail() { printf '[n31-preflight][BLOCKED] %s\n' "$*" >&2; exit 1; }
usage() { echo 'Usage: preflight-stage31.sh --env-file PRIVATE_ENV --report-file NEW_JSON [--release] [--live --confirm-live PROBE_PUBLIC_HEALTH]'; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) [ "$#" -ge 2 ] || fail 'Missing private env path'; ENV_FILE="$2"; shift 2 ;;
    --report-file) [ "$#" -ge 2 ] || fail 'Missing report path'; REPORT_FILE="$2"; shift 2 ;;
    --release) RELEASE=1; shift ;;
    --live) LIVE=1; shift ;;
    --confirm-live) [ "$#" -ge 2 ] || fail 'Missing live confirmation'; LIVE_CONFIRM="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) fail 'Unknown argument' ;;
  esac
done
[ -n "$ENV_FILE" ] && [ -n "$REPORT_FILE" ] || { usage; fail 'Explicit input and output paths required'; }
[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || fail 'Private env missing or symbolic link'
[ ! -e "$REPORT_FILE" ] && [ ! -L "$REPORT_FILE" ] || fail 'Refusing to overwrite an existing report'
[ "$ENV_FILE" != "$REPORT_FILE" ] || fail 'Report cannot overwrite deployment credentials'
if [ "$LIVE" -eq 1 ]; then
  [ "$LIVE_CONFIRM" = 'PROBE_PUBLIC_HEALTH' ] || fail 'Live external probe needs PROBE_PUBLIC_HEALTH confirmation'
else
  [ -z "$LIVE_CONFIRM" ] || fail 'Live confirmation supplied without --live'
fi
# Existing N14 validator inspects private permissions and never sources secrets.
if [ "$RELEASE" -eq 1 ]; then
  bash "$DIR/preflight-stage14.sh" --env-file "$ENV_FILE" --release >/dev/null
else
  bash "$DIR/preflight-stage14.sh" --env-file "$ENV_FILE" >/dev/null
fi
HOST="$(awk 'index($0,"SERVER_HOST=")==1 { print substr($0,13); exit }' "$ENV_FILE")"
[ -n "$HOST" ] || fail 'Validated public server host missing'
# Revalidate the host read from disk after N14; an .env edit between checks
# must never turn the optional public probe into an IP/reserved-host request.
bash "$DIR/verify-hostinger-acceptance.sh" --host "$HOST" --dry-run >/dev/null ||
  fail 'Host changed or is not a valid public DNS name'
if [ "$LIVE" -eq 1 ]; then
  # Real TLS/redirect/DB check, NEVER sends credentials from .env.
  bash "$DIR/verify-hostinger-acceptance.sh" --host "$HOST" --confirm-live "$LIVE_CONFIRM"
fi
# No untrusted env value except previously validated public-DNS hostname.
tmp="$(mktemp "$REPORT_FILE.tmp.XXXXXXXX")" || fail 'Cannot create protected report'
trap 'rm -f "$tmp"' EXIT
if [ "$LIVE" -eq 1 ]; then live_state='"VERIFIED_PUBLIC_HTTPS"' ; else live_state='"NOT_TESTED"' ; fi
if [ "$RELEASE" -eq 1 ]; then release_state='"RELEASE_CONFIG_SYNTAX_ONLY"' ; else release_state='"NOT_REQUESTED"' ; fi
printf '{"schema":"aaditech-stage31-preflight-v1","decision":"EXTERNAL_APPROVAL_REQUIRED","configuration":"VALIDATED_OFFLINE","public_https":%s,"signed_release":%s,"customer_backup_restore":"NOT_TESTED","physical_windows":"NOT_TESTED","host":"%s","credentials_exposed":false}\n' \
  "$live_state" "$release_state" "$HOST" > "$tmp"
chmod 600 "$tmp"
# ln(2) creates the new destination atomically and fails with EEXIST.
# Unlike mv -n, it cannot silently report success when another writer wins.
# Keep the restrictive mktemp permissions and clean up the temporary hardlink.
ln "$tmp" "$REPORT_FILE" || fail 'Report path was created concurrently or cannot be created safely'
rm -f "$tmp"
trap - EXIT
say 'CONFIG_READY_FOR_OPERATOR_REVIEW (NOT signed release or production acceptance)'
say 'No credentials printed; no deployment, DNS, backup or installer changes.'
