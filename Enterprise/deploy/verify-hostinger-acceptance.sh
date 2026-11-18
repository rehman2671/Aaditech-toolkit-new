#!/usr/bin/env bash
# Read-only live public HTTPS acceptance: Docker-capable Hostinger VPS.
# Never changes DNS, containers, database or server files and never sends secrets.
set -euo pipefail
usage() { echo "Usage: $0 --host PUBLIC_DNS_HOST [--dry-run]"; }
die() { echo "[hostinger-acceptance][BLOCKED] $*" >&2; exit 1; }
HOST='' ; DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --host) [ "$#" -ge 2 ] || die '--host requires DNS'; HOST="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
[[ "$HOST" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$ ]] ||
  die 'Expected a DNS hostname, not a URL, IP or localhost.'
# Case-insensitive reserved-zone policy; numeric dotted hostnames can be
# interpreted as IP literals by curl and must never pass as public DNS.
lower_host="${HOST,,}"
case "$lower_host" in
  *.local|*.localhost|*.test|*.example|*.invalid|example.com|*.example.com|example.net|*.example.net|example.org|*.example.org)
    die 'Reserved/non-public DNS hostname is not valid for live acceptance.' ;;
esac
[[ "$HOST" =~ \.[A-Za-z][A-Za-z0-9-]*$ ]] ||
  die 'Public DNS needs a nonnumeric final label; IP literals are not accepted.'
if [ "$DRY_RUN" -eq 1 ]; then
  echo '[hostinger-acceptance] DRY RUN: valid DNS syntax, no network or deployment operations performed.'
  exit 0
fi
command -v curl >/dev/null 2>&1 || die 'curl is required.'
command -v python3 >/dev/null 2>&1 || die 'python3 is required for live public DNS address validation.'
command -v grep >/dev/null 2>&1 || die 'grep is required.'
command -v mktemp >/dev/null 2>&1 || die 'mktemp is required.'
# Resolve once, reject ALL non-global answers, then pin curl at the approved
# address so DNS rebinding between validation and the requests cannot redirect
# health probes to private/loopback/metadata endpoints. No proxy may override
# the pinned route. A single endpoint is chosen fail-closed, never retried
# automatically against a second address.
PIN_IP="$(python3 "$(dirname "$0")/resolve-public-host.py" "$HOST")" ||
  die 'Public DNS returned invalid/untrusted addresses or could not be resolved.'
[ -n "$PIN_IP" ] || die 'Public DNS pin was empty.'
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
# -q must be the first curl option to ignore untrusted ~/.curlrc overrides.\n# curl validates OS CA trust, hostname verification and HTTPS protocol.
# The operator's ambient curl trust overrides must not silently replace the
# system CA store, or an unrelated private CA could satisfy our HTTPS check.
# Only unset for this subprocess; no user shell or filesystem is modified.
status="$(
  unset CURL_CA_BUNDLE SSL_CERT_FILE SSL_CERT_DIR CURL_SSL_BACKEND || exit 1
  curl -q --silent --show-error --noproxy '*' --resolve "$HOST:443:$PIN_IP" \
    --proto '=https' --tlsv1.2 --connect-timeout 8 --max-time 18 \
    --max-filesize 65536 --output "$body" --write-out '%{http_code}' "https://$HOST/healthz"
)" ||
  die 'Public HTTPS/certificate/network health check failed.'
[ "$status" = '200' ] || die "Remote healthz returned HTTP $status, expected 200."
# Parse actual JSON hierarchy (not raw grep matches). Reject duplicate keys,
# forged nested values and oversized responses; never log a health response.
python3 "$(dirname "$0")/validate-public-health.py" "$body" ||
  die 'Remote healthz response is malformed, ambiguous or persistent MySQL is degraded.'
# -q must be curl's FIRST argument: disable ~/.curlrc, whose options could
# silently override pinned routes, TLS verification or redirect behavior.
# Demand a genuine HTTP redirect status plus the approved HTTPS origin.
# --max-redirs 0 and no --location means the redirect target is never fetched.
redirect_result="$(
  unset CURL_CA_BUNDLE SSL_CERT_FILE SSL_CERT_DIR CURL_SSL_BACKEND || exit 1
  curl -q --silent --show-error --head --noproxy '*' \
    --resolve "$HOST:80:$PIN_IP" --proto '=http' --max-time 15 --max-redirs 0 --output /dev/null \
    --write-out '%{http_code} %{redirect_url}' "http://$HOST/"
)" ||
  die 'HTTP port 80 is not reachable for HTTPS redirect check.'
redirect_status="${redirect_result%% *}"
redirect="${redirect_result#* }"
case "$redirect_status" in
  301|302|303|307|308) ;;
  *) die 'HTTP port 80 must return an actual HTTPS redirect status (301/302/303/307/308).' ;;
esac
case "$redirect" in
  "https://$HOST/"*) ;;
  *) die 'HTTP port 80 must redirect to the expected HTTPS origin.' ;;
esac
echo "[hostinger-acceptance][PASS] https://$HOST/healthz verified with curl system CA trust and reports MySQL HEALTHY."
echo '[hostinger-acceptance][PASS] Plain HTTP redirects to the expected HTTPS host.'
echo '[hostinger-acceptance][PENDING] External VPS ownership, backup restore, tenant/API and Windows enrollment must be approved separately.'
