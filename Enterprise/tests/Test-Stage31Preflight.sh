#!/usr/bin/env bash
# Synthetic offline-only configuration fixtures. No public HTTPS probes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/Enterprise/deploy/preflight-stage31.sh"
bash -n "$CLI"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
envfile="$work/.env"
{
  printf '%s\n' 'MYSQL_DATABASE=it_toolkit' 'MYSQL_USER=itk_user'
  n=1
  for key in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD API_TOKEN JWT_SECRET BOOTSTRAP_SECRET HMAC_SECRET COMMAND_SIGNING_KEY SETUP_TOKEN; do
    printf '%s=%064d\n' "$key" "$n"
    n=$((n+1))
  done
  printf '%s\n' 'SERVER_HOST=console.aaditech.net' 'CADDY_HOST=console.aaditech.net'
  printf '%s\n' 'PLATFORM_ADMIN_USER_ID=81'
  printf '%s\n' 'PLATFORM_OWNER_TENANT_ID=00000000-0000-0000-0000-000000000081'
  printf '%s\n' 'APPROVED_MSI_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
} > "$envfile"
chmod 600 "$envfile"
bash "$CLI" --env-file "$envfile" --report-file "$work/preview.json" --release > "$work/output"
grep -q '"configuration":"VALIDATED_OFFLINE"' "$work/preview.json"
grep -q '"public_https":"NOT_TESTED"' "$work/preview.json"
grep -q '"decision":"EXTERNAL_APPROVAL_REQUIRED"' "$work/preview.json"
grep -q '"signed_release":"RELEASE_CONFIG_SYNTAX_ONLY"' "$work/preview.json"
grep -q '"credentials_exposed":false' "$work/preview.json"
[ "$(stat -c '%a' "$work/preview.json")" = 600 ]
if grep -q '000000000000000000000000000000' "$work/output" "$work/preview.json"; then
  echo '[FAIL] synthetic credential leaked to report' >&2; exit 1
fi
must_fail() {
  if bash "$CLI" --env-file "$envfile" --report-file "$work/should-not-exist.json" "$@" >/dev/null 2>&1; then
    echo '[FAIL] unsafe N31 preflight was accepted' >&2; exit 1
  fi
  [ ! -f "$work/should-not-exist.json" ] || { echo '[FAIL] unsafe input wrote a report' >&2; exit 1; }
}
must_fail --live
must_fail --confirm-live PROBE_PUBLIC_HEALTH
must_fail --live --confirm-live NOT_APPROVED
if bash "$CLI" --env-file "$envfile" --report-file "$work/preview.json" >/dev/null 2>&1; then
  echo '[FAIL] preflight overwrote existing report' >&2; exit 1
fi
# A preexisting symlink must not be followed or overwritten.
printf '%s\n' 'SENTINEL-UNCHANGED' > "$work/target"
ln -s "$work/target" "$work/linked.json"
if bash "$CLI" --env-file "$envfile" --report-file "$work/linked.json" >/dev/null 2>&1; then
  echo '[FAIL] symlink report target accepted' >&2; exit 1
fi
[ "$(cat "$work/target")" = 'SENTINEL-UNCHANGED' ] || { echo '[FAIL] sentinel changed' >&2; exit 1; }
# Two independent processes targeting one report must result in exactly one
# successful publication; not two misleading CONFIG_READY successes.
set +e
bash "$CLI" --env-file "$envfile" --report-file "$work/race.json" >"$work/race1.out" 2>&1 &
pid1=$!
bash "$CLI" --env-file "$envfile" --report-file "$work/race.json" >"$work/race2.out" 2>&1 &
pid2=$!
wait "$pid1"; rc1=$?
wait "$pid2"; rc2=$?
set -e
[ $(( (rc1 == 0) + (rc2 == 0) )) -eq 1 ] || {
  echo '[FAIL] expected exactly one atomic report publisher' >&2; exit 1;
}
grep -q '"decision":"EXTERNAL_APPROVAL_REQUIRED"' "$work/race.json"
# Offline host validation and live dry-run must agree on reserved and IP hosts.
checker="$ROOT/Enterprise/deploy/verify-hostinger-acceptance.sh"
for unsafe in '127.0.0.1' '127.0.0.01' 'console.example.net' 'CONSOLE.EXAMPLE.COM'; do
  if bash "$checker" --host "$unsafe" --dry-run >/dev/null 2>&1; then
    echo '[FAIL] unsafe live host accepted in dry-run' >&2; exit 1
  fi
done
chmod 644 "$envfile"
must_fail
chmod 600 "$envfile"
sed -i 's@console.aaditech.net@console.example@g' "$envfile"
must_fail
echo 'N31 PASS: offline config preflight redacted, fail closed, live opt-in required'
