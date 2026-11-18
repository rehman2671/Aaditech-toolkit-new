#!/usr/bin/env bash
# No external DNS or HTTPS requests: test the curl route pin contract with
# disposable mocks; test actual address classification in Python unittest.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECKER="$ROOT/Enterprise/deploy/verify-hostinger-acceptance.sh"
bash -n "$CHECKER"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
export CURL_CALLS="$work/curl.calls"
export REAL_PYTHON3="$(command -v python3)"
: > "$CURL_CALLS"
cat > "$work/bin/python3" <<'PYTHON'
#!/usr/bin/env bash
case "$1" in
  */resolve-public-host.py)
    if [ "${FAKE_DNS_DENY:-0}" = 1 ]; then exit 1; fi
    printf '%s\n' '8.8.8.8'
    ;;
  */validate-public-health.py)
    exec "$REAL_PYTHON3" "$@"
    ;;
  *) echo 'Unexpected python3 execution' >&2; exit 1 ;;
esac
PYTHON
cat > "$work/bin/curl" <<'CURL'
#!/usr/bin/env bash
# Missing -q as FIRST arg means ~/.curlrc can silently alter live curl options.
[ "${1:-}" = '-q' ] || { echo 'curlrc bypass missing' >&2; exit 97; }
printf '%s\n' "$*" >> "$CURL_CALLS"
case " $* " in
  *"https://console.aaditech.net/healthz"*)
    while [ "$#" -gt 0 ]; do
      if [ "$1" = '--output' ]; then
        shift
        if [ "${FAKE_HEALTH_DEGRADED:-0}" = 1 ]; then
          printf '%s\n' '{"status":"ok","database":"HEALTHY","components":{"database":"DEGRADED"}}' > "$1"
        else
          printf '%s\n' '{"status":"ok","components":{"database":"HEALTHY"}}' > "$1"
        fi
        break
      fi
      shift
    done
    printf '200'
    ;;
  *"http://console.aaditech.net/"*)
    printf '%s %s' "${FAKE_HTTP_STATUS:-301}" "${FAKE_HTTP_DEST:-https://console.aaditech.net/}"
    ;;
  *) exit 17 ;;
esac
CURL
chmod 700 "$work/bin/python3" "$work/bin/curl"
PATH="$work/bin:$PATH" bash "$CHECKER" --host console.aaditech.net >"$work/output"
grep -Fq -- '--resolve console.aaditech.net:443:8.8.8.8' "$CURL_CALLS"
grep -Fq -- '--resolve console.aaditech.net:80:8.8.8.8' "$CURL_CALLS"
[ "$(grep -Fc -- "--noproxy *" "$CURL_CALLS")" -eq 2 ]
[ "$(grep -Fc -- "-q --silent --show-error" "$CURL_CALLS")" -eq 2 ]
grep -Fq -- '--max-redirs 0' "$CURL_CALLS"
grep -Fq 'Public HTTPS' "$work/output" || grep -Fq '[PASS]' "$work/output"
# Reject deceptive responses with a Location URL but HTTP 200, and any
# cross-origin redirect (including private/internal redirect targets).
if FAKE_HTTP_STATUS=200 PATH="$work/bin:$PATH" bash "$CHECKER" --host console.aaditech.net >/dev/null 2>&1; then
  echo '[FAIL] HTTP 200 with Location accepted as a redirect' >&2; exit 1
fi
if FAKE_HTTP_DEST='https://127.0.0.1/' PATH="$work/bin:$PATH" bash "$CHECKER" --host console.aaditech.net >/dev/null 2>&1; then
  echo '[FAIL] cross-origin redirect accepted' >&2; exit 1
fi
# A response with an enticing top-level database field but an unhealthy
# authoritative components.database must never be accepted. The fake resolver
# still returns a public IP; this covers the actual structured parser path.
if FAKE_HEALTH_DEGRADED=1 PATH="$work/bin:$PATH" bash "$CHECKER" --host console.aaditech.net >/dev/null 2>&1; then
  echo '[FAIL] nested degraded MySQL accepted by real health JSON parser' >&2; exit 1
fi
before="$(wc -l < "$CURL_CALLS")"
if FAKE_DNS_DENY=1 PATH="$work/bin:$PATH" bash "$CHECKER" --host console.aaditech.net > /dev/null 2>&1; then
  echo '[FAIL] DNS refusal did not block public probes' >&2; exit 1
fi
[ "$(wc -l < "$CURL_CALLS")" -eq "$before" ] || {
  echo '[FAIL] curl invoked despite rejected DNS' >&2; exit 1;
}
# --dry-run must not consult DNS or make HTTP calls.
FAKE_DNS_DENY=1 PATH="$work/bin:$PATH" bash "$CHECKER" --host console.aaditech.net --dry-run >/dev/null
[ "$(wc -l < "$CURL_CALLS")" -eq "$before" ]
echo 'N37 PASS: only pinned HTTPS/HTTP routes used; untrusted DNS and dry-run never reach curl'
