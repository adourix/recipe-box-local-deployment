#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${APP_USER:-${SUDO_USER:-$(id -un)}}"

if [[ "$(id -u)" -eq 0 && -z "${SUDO_USER:-}" && -z "${APP_USER:-}" ]]; then
  echo "Run this script as the deployment user or with sudo from that user." >&2
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Missing $ROOT/.env" >&2
  echo "Run: cp .env.example .env && bash scripts/generate-local-keys.sh" >&2
  exit 1
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  echo "User '$APP_USER' does not exist." >&2
  exit 1
fi

run_as_app() {
  sudo -u "$APP_USER" -- "$@"
}

NPM_BIN="$(sudo -u "$APP_USER" -- bash -lc 'command -v npm' || true)"
NODE_BIN="$(sudo -u "$APP_USER" -- bash -lc 'command -v node' || true)"
PYTHON_BIN="$(sudo -u "$APP_USER" -- bash -lc 'command -v python3' || true)"

for pair in "npm:$NPM_BIN" "node:$NODE_BIN" "python3:$PYTHON_BIN"; do
  name="${pair%%:*}"
  path="${pair#*:}"
  if [[ -z "$path" ]]; then
    echo "Missing $name for user $APP_USER." >&2
    exit 1
  fi
done

NODE_MAJOR="$(sudo -u "$APP_USER" -- bash -lc 'node -p "process.versions.node.split(\".\")[0]"')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 20+ is required; found Node.js $NODE_MAJOR." >&2
  exit 1
fi

if ! "$PYTHON_BIN" -m venv --help >/dev/null 2>&1; then
  echo "Python venv support is missing. Install python3-venv first." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd is required for the service installation." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for the final health checks." >&2
  exit 1
fi

# Generate application secrets without replacing existing values.
run_as_app bash -lc "cd '$ROOT' && bash scripts/generate-local-keys.sh"

# Install Python dependencies into a project-local venv.
run_as_app "$PYTHON_BIN" -m venv "$ROOT/services/recipe-resolver/.venv"
run_as_app "$ROOT/services/recipe-resolver/.venv/bin/python" -m pip install --upgrade pip
run_as_app "$ROOT/services/recipe-resolver/.venv/bin/pip" install -r "$ROOT/services/recipe-resolver/requirements.txt"

# Build and verify the Next.js application as the real service user.
run_as_app bash -lc "cd '$ROOT' && npm ci && npm run lint && npm test && npm run build"

# Install systemd units with paths resolved for this server.
install_unit() {
  local source="$1" target="$2"
  sed \
    -e "s|__APP_USER__|$APP_USER|g" \
    -e "s|__APP_DIR__|$ROOT|g" \
    -e "s|__NPM_BIN__|$NPM_BIN|g" \
    "$source" | sudo tee "$target" >/dev/null
  sudo chmod 644 "$target"
}

install_unit "$ROOT/deploy/systemd/recipe-resolver.service" /etc/systemd/system/recipe-resolver.service
install_unit "$ROOT/deploy/systemd/recipe-box.service" /etc/systemd/system/recipe-box.service

sudo systemctl daemon-reload
sudo systemctl enable recipe-resolver.service recipe-box.service
sudo systemctl restart recipe-resolver.service
sudo systemctl restart recipe-box.service

sleep 2

if ! curl -fsS http://127.0.0.1:8081/health >/dev/null; then
  sudo systemctl --no-pager --full status recipe-resolver.service || true
  exit 1
fi

if ! curl -fsS http://127.0.0.1:3004/api/health >/dev/null; then
  sudo systemctl --no-pager --full status recipe-box.service || true
  exit 1
fi

echo "Bare-metal Recipe Box installation completed."
echo "App:      http://127.0.0.1:3004"
echo "Resolver: http://127.0.0.1:8081/health"
echo "Services: recipe-resolver.service, recipe-box.service"
echo "Next: verify the local Supabase API/Storage, apply the migration, then configure Nginx/Cloudflare."
