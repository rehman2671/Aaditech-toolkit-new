#!/usr/bin/env bash
# Disposable GitHub-hosted CI only. Unique project, no production input.
set -euo pipefail
umask 077
[ "$#" -eq 0 ] && [ "${GITHUB_ACTIONS:-}" = true ] &&
  [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] &&
  [ "${GITHUB_RUN_ID:-}" != '' ] && [[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]] || exit 2
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HERE/.env"
COMPOSE_FILE="$HERE/docker-compose.yml"
[ ! -e "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || { echo 'Existing deployment config refused' >&2; exit 2; }
while IFS= read -r key; do
  case "$key" in
    COMPOSE_*|DOCKER_*|MYSQL_*|API_TOKEN|JWT_SECRET|BOOTSTRAP_SECRET|HMAC_SECRET|COMMAND_SIGNING_KEY|SETUP_TOKEN|SESSION_SECRET|SERVER_HOST|CADDY_HOST|ENVIRONMENT|PLATFORM_ADMIN_USER_ID|PLATFORM_OWNER_TENANT_ID|WEBHOOK_ALLOWED_HOSTS|GITHUB_ACTIONS_REPO|GITHUB_ACTIONS_TOKEN|SMTP_*|APPROVED_MSI_SHA256|AADITECH_RECOVERY_EXPECTED_ENV_SHA) unset "$key" ;;
  esac
done < <(compgen -e)
project="itk_rehearsal_$GITHUB_RUN_ID"
docker_local() { docker --host unix:///run/docker.sock "$@"; }
for type in container network volume; do
  args=(ls --quiet --filter "label=com.docker.compose.project=$project")
  if [ "$type" = container ]; then args+=(--all); fi
  observed="$(docker_local "$type" "${args[@]}")" || exit 2
  [ -z "$observed" ] || { echo 'Existing fixture project refused' >&2; exit 2; }
done
for role in mysqldata api_data caddy_data caddy_config agent_artifacts; do
  if docker_local volume inspect "${project}_$role" >/dev/null 2>&1; then exit 2; fi
done
if docker_local network inspect "${project}_ittoolkit" >/dev/null 2>&1; then exit 2; fi
(set -o noclobber; : > "$ENV_FILE") || exit 2
cleanup() {
  status=$?
  docker_local compose --project-directory "$HERE" --project-name "$project" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || { echo 'Disposable fixture cleanup unconfirmed' >&2; status=1; }
  rm -f -- "$ENV_FILE"
  exit "$status"
}
trap cleanup EXIT
{
  printf 'COMPOSE_PROJECT_NAME=%s\nMYSQL_DATABASE=it_toolkit_rehearsal\nMYSQL_USER=itk_ci_user\n' "$project"
  for key in MYSQL_ROOT_PASSWORD MYSQL_PASSWORD API_TOKEN JWT_SECRET HMAC_SECRET BOOTSTRAP_SECRET COMMAND_SIGNING_KEY SETUP_TOKEN SESSION_SECRET; do
    value="$(openssl rand -hex 32)"
    printf '::add-mask::%s\n' "$value" >&2
    printf '%s=%s\n' "$key" "$value"
  done
  printf 'SERVER_HOST=ci.example.org\nCADDY_HOST=ci.example.org\nENVIRONMENT=prod\n'
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
docker_local compose --project-directory "$HERE" --project-name "$project" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
AADITECH_REHEARSAL=isolated-ci bash "$HERE/tests/Test-MySQL-Live-Rehearsal.sh"
