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
: > "$CURL_CALLS"
cat > "$work/bin/python3" <<'PYTHON'
#!/usr/bin/env bash
if [ "${FAKE_DNS_DENY:-0}" = 1 ]; then exit 1; fi
printf '%s\n' '8.8.8.8'
PYTHON
cat > "$work/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_CALLS"
case " $* " in
  *"https://console.aaditech.net/healthz"*)
    while [ "$#" -gt 0 ]; do
      if [ "$1" = '--output' ]; then
        shift
        printf '%s\n' '{"status":"ok","database":"HEALTHY"}' > "$1"
        break
      fi
      shift
    done
    printf '200'
    ;;
  *"http://console.aaditech.net/"*)
    printf 'https://console.aaditech.net/'
    ;;
  *) exit 17 ;;
esac
CURL
chmod 700 "$work/bin/python3" "$work/bin/curl"
PATH="$work/bin:$PATH" bash "$CHECKER" --host console.aaditech.net >"$work/output"
grep -Fq -- '--resolve console.aaditech.net:443:8.8.8.8' "$CURL_CALLS"
grep -Fq -- '--resolve console.aaditech.net:80:8.8.8.8' "$CURL_CALLS"
[ "$(grep -Fc -- "--noproxy *" "$CURL_CALLS")" -eq 2 ]
grep -Fq 'Public HTTPS' "$work/output" || grep -Fq '[PASS]' "$work/output"
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
