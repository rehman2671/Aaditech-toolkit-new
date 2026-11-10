#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HERE/.env"
command -v docker >/dev/null || { echo "Docker Desktop/Engine is required" >&2; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL is required" >&2; exit 1; }
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  {
    printf 'MYSQL_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 36)"
    printf 'MYSQL_DATABASE=it_toolkit\n'
    printf 'MYSQL_USER=itk_user\n'
    printf 'MYSQL_PASSWORD=%s\n' "$(openssl rand -hex 36)"
    printf 'SERVER_HOST=localhost\n'
    printf 'CADDY_HOST=:80\n'
  } > "$ENV_FILE"
  echo "Generated Enterprise/.env with MySQL credentials."
else
  echo "Keeping existing Enterprise/.env and database volumes."
fi
chmod 600 "$ENV_FILE"
docker compose --env-file "$ENV_FILE" -f "$HERE/docker-compose.yml" up -d --build db api
echo "Open locally only: http://localhost:3000/"
printf 'Retrieve host setup code:\n  docker compose --env-file "%s" -f "%s/docker-compose.yml" exec -T api cat /data/first-run-setup-code\n' "$ENV_FILE" "$HERE"
echo "Never expose this HTTP bootstrap page to another machine."
