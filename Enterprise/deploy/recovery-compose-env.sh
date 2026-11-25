#!/usr/bin/env bash
# Trusted helper: literal configuration, local daemon and explicit project.
# Does not authenticate backups or authorize a production restore.
RECOVERY_DIR=''
RECOVERY_ENV=''
RECOVERY_ENV_SHA=''
RECOVERY_PROJECT=''
recovery_cleanup() {
  if [ -n "$RECOVERY_DIR" ]; then rm -rf -- "$RECOVERY_DIR"; RECOVERY_DIR=''; fi
}
recovery_fail() { printf '%s\n' '[recovery][ERROR] Private literal Compose configuration unverified.' >&2; return 1; }
prepare_recovery_env() {
  local source="$1" expected="$2" before after size mode owner links line key value
  local -A values=()
  [ -f "$source" ] && [ ! -L "$source" ] || { recovery_fail; return 1; }
  before="$(stat -c '%d:%i:%u:%a:%h:%s:%y:%z' -- "$source")" || return 1
  read -r mode owner links size < <(stat -c '%a %u %h %s' -- "$source")
  [[ "$mode" = 600 || "$mode" = 400 ]] && [ "$owner" = "$(id -u)" ] &&
    [ "$links" = 1 ] && [[ "$size" =~ ^[0-9]+$ ]] && [ "$size" -gt 0 ] && [ "$size" -le 262144 ] || { recovery_fail; return 1; }
  RECOVERY_DIR="$(mktemp -d)" || return 1
  chmod 700 "$RECOVERY_DIR" || return 1
  RECOVERY_ENV="$RECOVERY_DIR/environment"
  cp -- "$source" "$RECOVERY_ENV" || return 1
  chmod 600 "$RECOVERY_ENV" || return 1
  after="$(stat -c '%d:%i:%u:%a:%h:%s:%y:%z' -- "$source")" || return 1
  [ "$before" = "$after" ] && [ ! -L "$source" ] && [ "$(wc -c < "$RECOVERY_ENV")" -eq "$size" ] || { recovery_fail; return 1; }
  cmp -s "$RECOVERY_ENV" <(tr -d '\000' < "$RECOVERY_ENV") || { recovery_fail; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" != *$'\r'* ]] || { recovery_fail; return 1; }
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=([a-zA-Z0-9_./:@,+%=-]*)$ ]] || { recovery_fail; return 1; }
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    case "$key" in
      COMPOSE_PROJECT_NAME|MYSQL_DATABASE|MYSQL_USER|MYSQL_PASSWORD|MYSQL_ROOT_PASSWORD|API_TOKEN|JWT_SECRET|BOOTSTRAP_SECRET|HMAC_SECRET|COMMAND_SIGNING_KEY|SETUP_TOKEN|SESSION_SECRET|SERVER_HOST|CADDY_HOST|ENVIRONMENT|PLATFORM_ADMIN_USER_ID|PLATFORM_OWNER_TENANT_ID|WEBHOOK_ALLOWED_HOSTS|GITHUB_ACTIONS_REPO|GITHUB_ACTIONS_TOKEN|SMTP_HOST|SMTP_PORT|SMTP_SECURITY|SMTP_USER|SMTP_PASSWORD|SMTP_FROM|SMTP_ALLOWED_RECIPIENT_DOMAINS|SMTP_TIMEOUT_MS|APPROVED_MSI_SHA256) ;;
      *) recovery_fail; return 1 ;;
    esac
    [[ ! -v "values[$key]" ]] || { recovery_fail; return 1; }
    values["$key"]="$value"
  done < "$RECOVERY_ENV"
  DB_NAME="${values[MYSQL_DATABASE]:-it_toolkit}"
  DB_USER="${values[MYSQL_USER]:-itk_user}"
  RECOVERY_PROJECT="${values[COMPOSE_PROJECT_NAME]:-enterprise}"
  [[ "$DB_NAME" =~ ^[A-Za-z0-9_]{1,64}$ && "$DB_USER" =~ ^[A-Za-z0-9_]{1,64}$ &&
     "$RECOVERY_PROJECT" =~ ^[a-z0-9][a-z0-9_-]{0,47}$ && -n "${values[MYSQL_PASSWORD]:-}" ]] || { recovery_fail; return 1; }
  RECOVERY_ENV_SHA="$(sha256sum -- "$RECOVERY_ENV")" || return 1
  RECOVERY_ENV_SHA="${RECOVERY_ENV_SHA%% *}"
  [[ "$RECOVERY_ENV_SHA" =~ ^[a-f0-9]{64}$ ]] && { [ -z "$expected" ] || [ "$expected" = "$RECOVERY_ENV_SHA" ]; } || { recovery_fail; return 1; }
}
recovery_compose() (
  local key observed
  observed="$(sha256sum -- "$RECOVERY_ENV")" || return 1
  [ "${observed%% *}" = "$RECOVERY_ENV_SHA" ] || { recovery_fail; return 1; }
  while IFS= read -r key; do
    case "$key" in
      COMPOSE_*|DOCKER_*|MYSQL_*|API_TOKEN|JWT_SECRET|BOOTSTRAP_SECRET|HMAC_SECRET|COMMAND_SIGNING_KEY|SETUP_TOKEN|SESSION_SECRET|SERVER_HOST|CADDY_HOST|ENVIRONMENT|PLATFORM_ADMIN_USER_ID|PLATFORM_OWNER_TENANT_ID|WEBHOOK_ALLOWED_HOSTS|GITHUB_ACTIONS_REPO|GITHUB_ACTIONS_TOKEN|SMTP_*|APPROVED_MSI_SHA256) unset "$key" ;;
    esac
  done < <(compgen -e)
  docker --host unix:///run/docker.sock compose --project-directory "$HERE" --project-name "$RECOVERY_PROJECT" --env-file "$RECOVERY_ENV" -f "$COMPOSE_FILE" "$@"
)
