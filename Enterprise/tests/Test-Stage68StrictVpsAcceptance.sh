#!/usr/bin/env bash
# N68: execute real deployment admission with disposable mock Docker/verifier.
# No production Docker, network, DNS probe, or signing credentials.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ORIGINAL="$ROOT/Enterprise/deploy/deploy-mysql.sh"
bash -n "$ORIGINAL"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/Enterprise/deploy" "$work/bin"
cp "$ORIGINAL" "$work/Enterprise/deploy/"
cp "$ROOT/Enterprise/deploy/preflight-stage14.sh" "$work/Enterprise/deploy/"
cp "$ROOT/Enterprise/docker-compose.yml" "$work/Enterprise/"
deploy="$work/Enterprise/deploy/deploy-mysql.sh"
env_path="$work/Enterprise/.env"
export N68_VERIFIER_CALLS="$work/verifier.calls"
export N68_DOCKER_CALLS="$work/docker.calls"
: > "$N68_VERIFIER_CALLS"
: > "$N68_DOCKER_CALLS"

# Stage 37 tests the actual verifier's DNS/CA/TLS/JSON behavior. This fake
# records only whether deploy-mysql delegates to it on both code paths.
cat > "$work/Enterprise/deploy/verify-hostinger-acceptance.sh" <<'VERIFIER'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$N68_VERIFIER_CALLS"
[ "$#" -ge 3 ] && [ "$1" = --host ] &&
    [ "$2" = toolkit.aaditech.net ] || exit 81
case "${3:-}" in
    --dry-run)
        [ "$#" -eq 3 ] || exit 82
        ;;
    --confirm-live)
        [ "$#" -eq 4 ] && [ "$4" = PROBE_PUBLIC_HEALTH ] || exit 83
        [ "${N68_FAKE_HEALTH:-reject}" = accept ] || exit 84
        ;;
    *) exit 85 ;;
esac
VERIFIER
cat > "$work/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$N68_DOCKER_CALLS"
# Every Docker operation is simulated in this sandbox; no daemon.
exit 0
DOCKER
cat > "$work/bin/sleep" <<'SLEEP'
#!/usr/bin/env bash
# Do not make the negative retry regression take 85 seconds.
exit 0
SLEEP
chmod 700 "$work/bin/docker" "$work/bin/sleep"

# Local-only fake secrets with >=32 unique bytes. Stage14 validates them.
{
    printf 'MYSQL_DATABASE=it_toolkit\nMYSQL_USER=itk_user\n'
    for pair in \
        'MYSQL_PASSWORD=a' 'MYSQL_ROOT_PASSWORD=b' 'API_TOKEN=c' \
        'JWT_SECRET=d' 'BOOTSTRAP_SECRET=e' 'HMAC_SECRET=f' \
        'COMMAND_SIGNING_KEY=g' 'SETUP_TOKEN=h'; do
        key="${pair%%=*}"
        letter="${pair#*=}"
        printf '%s=%s\n' "$key" "$(printf '%032d' 0 | tr '0' "$letter")"
    done
    printf 'SERVER_HOST=toolkit.aaditech.net\nCADDY_HOST=toolkit.aaditech.net\nENVIRONMENT=prod\n'
} > "$env_path"
chmod 600 "$env_path"
original_sha="$(sha256sum "$env_path" | cut -d' ' -f1)"

N68_FAKE_HEALTH=accept PATH="$work/bin:$PATH" bash "$deploy" > "$work/accepted.log"
grep -Fxq -- '--host toolkit.aaditech.net --dry-run' "$N68_VERIFIER_CALLS"
grep -Fxq -- '--host toolkit.aaditech.net --confirm-live PROBE_PUBLIC_HEALTH' "$N68_VERIFIER_CALLS"
grep -Fq -- 'up -d --build --wait --wait-timeout 180' "$N68_DOCKER_CALLS"
grep -Fq -- 'Strict HTTPS, MySQL HEALTHY and same-origin redirect verified' "$work/accepted.log"
[ "$original_sha" = "$(sha256sum "$env_path" | cut -d' ' -f1)" ] || {
    echo 'N68 deployment mutated existing credentials' >&2; exit 1;
}

: > "$N68_VERIFIER_CALLS"
if N68_FAKE_HEALTH=reject PATH="$work/bin:$PATH" bash "$deploy" > "$work/rejected.log" 2>&1; then
    echo 'N68 accepted failed strict Hostinger live probe' >&2; exit 1
fi
grep -Fq -- 'Strict public HTTPS, structured MySQL health or redirect acceptance failed' "$work/rejected.log"
if grep -Fq -- 'Strict HTTPS, MySQL HEALTHY and same-origin redirect verified' "$work/rejected.log"; then
    echo 'N68 falsely claimed VPS readiness after rejected probe' >&2; exit 1
fi
[ "$(grep -Fc -- '--confirm-live PROBE_PUBLIC_HEALTH' "$N68_VERIFIER_CALLS")" -eq 18 ] || {
    echo 'N68 bypassed strict verification during bounded live retries' >&2; exit 1;
}
[ "$original_sha" = "$(sha256sum "$env_path" | cut -d' ' -f1)" ] || {
    echo 'N68 failure path mutated deployment credentials' >&2; exit 1;
}

# Ensure actual deployer uses structured verification and never falls back
# to grep-based health acceptance or raw ambient curl.
python3 - "$ORIGINAL" <<'PY'
import pathlib, sys
s=pathlib.Path(sys.argv[1]).read_text()
for marker in ('--dry-run >/dev/null', '--confirm-live PROBE_PUBLIC_HEALTH',
               'preflight-stage14.sh', 'compose up -d --build --wait',
               'Strict public HTTPS, structured MySQL health'):
    assert marker in s, f'missing N68 admission step: {marker}'
assert s.index('preflight-stage14.sh') < s.index('compose up -d --build --wait')
assert 'grep -Eq' not in s[s.index('# N68: never use grep against'):]
assert 'curl --fail --silent --show-error --max-time 8' not in s
PY
echo 'N68 PASS: real deployment requires strict public HTTPS/JSON admission; mock failure never certifies readiness or rotates credentials.'
