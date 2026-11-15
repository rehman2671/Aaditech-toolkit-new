#!/usr/bin/env bash
# Node.js + MySQL Docker deployment (VPS/cloud server with a real DNS hostname).
# Unlike legacy deploy.sh, does NOT use PostgreSQL, Python or baked-in agent
# credentials. HTTPS is managed by Caddy; agent enrollment uses HTTPS tokens.
#
# Usage:
#   ./deploy-mysql.sh --host toolkit.example.com --dry-run
#   ./deploy-mysql.sh --host toolkit.example.com
#   ./deploy-mysql.sh                 # redeploy using unchanged Enterprise/.env
#   ./deploy-mysql.sh --host new.example.com --update-host  # preserve DB secrets
#
# Do not use on Hostinger shared hosting without Docker/ports 80,443 support.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HERE/.env"
COMPOSE_FILE="$HERE/docker-compose.yml"
HOST=""
UPDATE_HOST=0
DRY_RUN=0

log() { printf '[deploy-mysql] %s\n' "$*"; }
die() { printf '[deploy-mysql][ERROR] %s\n' "$*" >&2; exit 1; }
usage() { echo "Usage: $0 [--host dns.example.com] [--update-host] [--dry-run]"; }
while [ "$#" -gt 0 ]; do
    case "$1" in
        --host)
            [ "$#" -ge 2 ] || die "--host needs a DNS hostname."
            HOST="$2"; shift 2 ;;
        --update-host) UPDATE_HOST=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        --help|-h) usage; exit 0 ;;
        *) die "Unknown option: $1" ;;
    esac
done

# Existing .env is preserved as the source of database credentials. Never
# rotate passwords on an initialized MySQL volume just to change a hostname.
read_env() {
    [ -f "$ENV_FILE" ] || return 0
    awk -v key="$1" 'index($0, key "=")==1 { print substr($0, length(key)+2); exit }' "$ENV_FILE"
}
check_hostname() {
    local value="$1"
    [[ "$value" =~ ^[[:alnum:]]([[:alnum:]-]*[[:alnum:]])?(\.[[:alnum:]]([[:alnum:]-]*[[:alnum:]])?)+$ ]] || die "Expected a DNS hostname, e.g. toolkit.example.com (received: $value)"
    [[ ! "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "Bare IPs cannot use public Caddy ACME TLS. Configure DNS and use its hostname."
    case "$value" in
        *.local|*.localhost|*.test|*.example|*.invalid|localhost) die "Public HTTPS requires a real DNS domain, not $value." ;;
    esac
}
secret() {
    openssl rand -hex 32 || die "OpenSSL could not generate a secure secret."
}
validate_env() {
    local key val
    for key in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD API_TOKEN JWT_SECRET BOOTSTRAP_SECRET HMAC_SECRET COMMAND_SIGNING_KEY SETUP_TOKEN; do
        val="$(read_env "$key")"
        [ -n "$val" ] || die "Required $key is absent/empty in $ENV_FILE."
        case "$val" in
            *CHANGE-ME*|*change-me*|your_*|your-*) die "Placeholder value detected for $key in $ENV_FILE." ;;
        esac
    done
    for key in MYSQL_DATABASE MYSQL_USER; do
        val="$(read_env "$key")"
        [[ "$val" =~ ^[A-Za-z0-9_]+$ ]] || die "Invalid or missing $key in $ENV_FILE."
    done
}

[ -f "$COMPOSE_FILE" ] || die "Missing $COMPOSE_FILE."
grep -Eq '^[[:space:]]*image:[[:space:]]*mysql:' "$COMPOSE_FILE" || die "Compose does not use the supported MySQL image."
if [ -f "$ENV_FILE" ]; then
    PREVIOUS_HOST="$(read_env SERVER_HOST)"
    PREVIOUS_CADDY_HOST="$(read_env CADDY_HOST)"
    if [ -z "$HOST" ]; then HOST="$PREVIOUS_HOST"; fi
    [ -n "$HOST" ] || die "SERVER_HOST missing in .env. Use --host."
    if [ "$HOST" != "$PREVIOUS_HOST" ] || [ "$HOST" != "$PREVIOUS_CADDY_HOST" ]; then
        [ "$UPDATE_HOST" -eq 1 ] || die "Hostname differs from .env. Supply --update-host to change ONLY SERVER_HOST/CADDY_HOST."
    fi
elif [ -z "$HOST" ]; then
    die "No Enterprise/.env exists. Use --host with the future public DNS hostname."
fi
check_hostname "$HOST"

if [ "$DRY_RUN" -eq 1 ]; then
    [ ! -f "$ENV_FILE" ] || validate_env
    log "DRY RUN: hostname $HOST is syntactically valid; no files or containers changed."
    log "Production requires public DNS, accessible ports 80/443, Docker Compose and a working ACME issuer."
    exit 0
fi

for cmd in docker openssl curl awk grep; do
    command -v "$cmd" >/dev/null 2>&1 || die "Missing prerequisite: $cmd"
done
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
docker info >/dev/null 2>&1 || die "Docker daemon unavailable."

if [ ! -f "$ENV_FILE" ]; then
    # Fail closed if any prior Compose MySQL volume exists and credentials are
    # missing. Initializing with new secrets would orphan existing data.
    if docker volume ls --format '{{.Name}}' | grep -Eq '(^|_)mysqldata$'; then
        die "Existing MySQL volume found but .env is missing. Recover previous credentials; do not regenerate."
    fi
    log "Generating a new Enterprise/.env with independent random secrets."
    TEMP_ENV="$(mktemp "${ENV_FILE}.XXXXXXXX")"
    trap 'rm -f "$TEMP_ENV"' EXIT
    {
        printf 'MYSQL_DATABASE=it_toolkit\n'
        printf 'MYSQL_USER=itk_user\n'
        printf 'MYSQL_PASSWORD=%s\n' "$(secret)"
        printf 'MYSQL_ROOT_PASSWORD=%s\n' "$(secret)"
        for key in API_TOKEN JWT_SECRET BOOTSTRAP_SECRET HMAC_SECRET COMMAND_SIGNING_KEY SETUP_TOKEN; do
            printf '%s=%s\n' "$key" "$(secret)"
        done
        printf 'SERVER_HOST=%s\nCADDY_HOST=%s\nENVIRONMENT=prod\n' "$HOST" "$HOST"
    } > "$TEMP_ENV"
    chmod 600 "$TEMP_ENV"
    mv "$TEMP_ENV" "$ENV_FILE"
    trap - EXIT
elif [ "$UPDATE_HOST" -eq 1 ]; then
    TEMP_ENV="$(mktemp "${ENV_FILE}.XXXXXXXX")"
    trap 'rm -f "$TEMP_ENV"' EXIT
    awk -v host="$HOST" '
      BEGIN { found_server=0; found_caddy=0 }
      /^SERVER_HOST=/ {print "SERVER_HOST=" host; found_server=1; next}
      /^CADDY_HOST=/ {print "CADDY_HOST=" host; found_caddy=1; next}
      {print}
      END {
        if (!found_server) print "SERVER_HOST=" host
        if (!found_caddy) print "CADDY_HOST=" host
      }
    ' "$ENV_FILE" > "$TEMP_ENV"
    chmod 600 "$TEMP_ENV"
    mv "$TEMP_ENV" "$ENV_FILE"
    trap - EXIT
    log "Updated hostname without rotating database or API secrets."
fi

chmod 600 "$ENV_FILE"
validate_env
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
log "Validating Node/MySQL Compose environment."
compose config --quiet || die "Invalid Compose configuration; no containers started."
log "Starting MySQL, Node API, and Caddy with automatic HTTPS."
compose up -d --build --wait --wait-timeout 180

# Verify real HTTPS reachability AND MySQL database health. /healthz itself
# returns HTTP 200 in degraded mode, so a simple HTTP status check is not enough.
HEALTHY=0
for i in $(seq 1 18); do
    if response="$(curl --fail --silent --show-error --max-time 8 "https://$HOST/healthz" 2>/dev/null)"; then
        if printf '%s' "$response" | grep -Eq '"database"[[:space:]]*:[[:space:]]*"HEALTHY"'; then
            HEALTHY=1
            break
        fi
    fi
    sleep 5
done
if [ "$HEALTHY" -ne 1 ]; then
    die "HTTPS/database acceptance failed. Confirm DNS A/AAAA, ports 80/443, Caddy ACME and MySQL readiness. Inspect: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs"
fi
log "Server reachable at https://$HOST/ and database reports HEALTHY."
log "Build a generic MSI, then configure each Windows device with Configure-Agent.ps1 using an admin-issued single-use bootstrap token."
log "TLS + agent credentials are enabled; legacy :9443 mTLS is NOT implemented by the Node backend."
