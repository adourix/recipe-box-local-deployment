#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env; first run: cp .env.example .env" >&2
  exit 1
fi
umask 077
set_env() {
  local key="$1" value="$2"
  if grep -q "^\${key}=" "$ENV_FILE"; then
    sed -i "s|^\${key}=.*|\${key}=\${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
rand_hex() { openssl rand -hex 32; }
for key in TELEGRAM_WEBHOOK_SECRET WORKER_SECRET EDIT_KEY CRON_SECRET RESOLVER_SECRET; do
  current="$(grep -E "^\${key}=" "$ENV_FILE" | cut -d= -f2- || true)"
  if [[ -z "$current" || "$current" == replace-* || "$current" == some-random-hex || "$current" == another-random-hex ]]; then
    set_env "$key" "$(rand_hex)"
  fi
done
chmod 600 "$ENV_FILE"
echo "Generated local application secrets in .env (values are not printed)."
