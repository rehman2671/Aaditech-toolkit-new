#!/usr/bin/env bash
# No-Docker regression tests for deploy-mysql.sh validation and dry-run safety.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bash -n "$ROOT/Enterprise/deploy/deploy-mysql.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/Enterprise/deploy"
cp "$ROOT/Enterprise/deploy/deploy-mysql.sh" "$WORK/Enterprise/deploy/"
cp "$ROOT/Enterprise/deploy/verify-hostinger-acceptance.sh" "$WORK/Enterprise/deploy/"
cp "$ROOT/Enterprise/deploy/preflight-stage14.sh" "$WORK/Enterprise/deploy/"
cp "$ROOT/Enterprise/docker-compose.yml" "$WORK/Enterprise/"
DEPLOY="$WORK/Enterprise/deploy/deploy-mysql.sh"
ENV_FILE="$WORK/Enterprise/.env"
die() { echo "[test] $*" >&2; exit 1; }
expect_failure() {
    if bash "$DEPLOY" "$@" > "$WORK/output" 2>&1; then
        die "Unexpected deploy success: $*"
    fi
}
# --dry-run with hostname must never generate a secret file or touch Docker.
bash "$DEPLOY" --host toolkit.aaditech.net --dry-run
[ ! -e "$ENV_FILE" ] || die "dry-run created .env"
expect_failure --dry-run
expect_failure --host 192.0.2.5 --dry-run
expect_failure --host toolkit.example.test --dry-run
expect_failure --host TOOLKIT.EXAMPLE.COM --dry-run
expect_failure --host test.localhost --dry-run
expect_failure --host 'https://toolkit.aaditech.net' --dry-run
expect_failure --host 'domain.aaditech.net/evil' --dry-run

cat > "$ENV_FILE" <<'EOF'
MYSQL_DATABASE=it_toolkit
MYSQL_USER=itk_user
MYSQL_PASSWORD=secret_pass_1234567890
MYSQL_ROOT_PASSWORD=root_secret_1234567890
API_TOKEN=agent_secret_1234567890
JWT_SECRET=jwt_secret_1234567890
BOOTSTRAP_SECRET=bootstrap_secret_1234567890
HMAC_SECRET=hmac_secret_1234567890
COMMAND_SIGNING_KEY=command_secret_1234567890
SETUP_TOKEN=setup_secret_123456789012345678901234567890
SERVER_HOST=toolkit.aaditech.net
CADDY_HOST=toolkit.aaditech.net
ENVIRONMENT=prod
EOF
BEFORE="$(sha256sum "$ENV_FILE" | cut -d' ' -f1)"
bash "$DEPLOY" --dry-run
bash "$DEPLOY" --host other.aaditech.net --update-host --dry-run
[ "$BEFORE" = "$(sha256sum "$ENV_FILE" | cut -d' ' -f1)" ] || die "dry-run changed existing credentials"

expect_failure --host other.aaditech.net --dry-run
expect_failure --host other.aaditech.net
expect_failure --host bogus.example.test --update-host --dry-run
sed -i 's/API_TOKEN=agent_secret_1234567890/API_TOKEN=change-me/' "$ENV_FILE"
expect_failure --dry-run
echo "[test] MySQL deployment dry-run safety tests passed."
