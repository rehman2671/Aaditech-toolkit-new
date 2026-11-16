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
case "$HOST" in
  *.local|*.localhost|*.test|*.example|*.invalid|*.example.com|*.example.net|*.example.org)
    die 'Reserved/non-public DNS hostname is not valid for live acceptance.' ;;
esac
if [ "$DRY_RUN" -eq 1 ]; then
  echo '[hostinger-acceptance] DRY RUN: valid DNS syntax, no network or deployment operations performed.'
  exit 0
fi
command -v curl >/dev/null 2>&1 || die 'curl is required.'
command -v grep >/dev/null 2>&1 || die 'grep is required.'
command -v mktemp >/dev/null 2>&1 || die 'mktemp is required.'
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
# curl validates OS CA trust, hostname verification and HTTPS protocol.
status="$(curl --silent --show-error --proto '=https' --tlsv1.2 \
  --connect-timeout 8 --max-time 18 --output "$body" --write-out '%{http_code}' \
  "https://$HOST/healthz")" || die 'Public HTTPS/certificate/network health check failed.'
[ "$status" = '200' ] || die "Remote healthz returned HTTP $status, expected 200."
grep -Eq '"database"[[:space:]]*:[[:space:]]*"HEALTHY"' "$body" ||
  die 'Remote healthz did not report a healthy persistent MySQL database.'
grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' "$body" ||
  die 'Remote healthz did not report status ok.'
redirect="$(curl --silent --show-error --head --max-time 15 --output /dev/null \
  --write-out '%{redirect_url}' "http://$HOST/" )" ||
  die 'HTTP port 80 is not reachable for HTTPS redirect check.'
case "$redirect" in
  "https://$HOST/"*) ;;
  *) die 'HTTP port 80 must redirect to the expected HTTPS origin.' ;;
esac
echo "[hostinger-acceptance][PASS] https://$HOST/healthz uses publicly trusted TLS and reports MySQL HEALTHY."
echo '[hostinger-acceptance][PASS] Plain HTTP redirects to the expected HTTPS host.'
echo '[hostinger-acceptance][PENDING] External VPS ownership, backup restore, tenant/API and Windows enrollment must be approved separately.'
