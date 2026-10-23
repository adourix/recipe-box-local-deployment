# كتاب وصفات أمير — Recipe Box

Personal Arabic recipe manager. Share a social-media link, video, photo, or text with Telegram to extract and save recipes in Arabic, then browse/search the recipe gallery.

This branch is the self-hosted deployment branch. `main` is left unchanged.

## Deployment model

The primary deployment path is **bare metal on Debian/Linux with systemd**. Docker is not required for Recipe Box or the Recipe Resolver.

```text
Internet
   |
Cloudflare Tunnel
   |
Nginx :8080
   |
   +--> Recipe Box :3004
   |
   +--> Supabase API :8000

Recipe Box :3004
   |
   +--> Resolver :8081
   |
   +--> Supabase API / Storage

Supabase API / Storage
   |
   +--> PostgreSQL :5432
```

The application deliberately keeps the Supabase interface. The server therefore needs a **local Supabase-compatible API + Storage + PostgreSQL stack**. This repository does not replace that interface with direct PostgreSQL access because the application uses Supabase REST and Storage through `@supabase/supabase-js`.

The old `docker-compose.yml` and `Dockerfile` are retained as a legacy deployment path; they are not used by the bare-metal installer.

## Components

- **Recipe Box:** Next.js 15 production server on `127.0.0.1:3004`.
- **Recipe Resolver:** Python + yt-dlp HTTP service on `127.0.0.1:8081`.
- **Supabase API / Storage:** local service required by the application.
- **PostgreSQL:** local database used by the Supabase layer.
- **Nginx:** reverse proxy on the existing `127.0.0.1:8080` listener.
- **Cloudflare Tunnel:** public ingress only; use the existing tunnel.
- **Gemini:** external API used for recipe extraction; `GEMINI_API_KEY` is required for extraction.
- **Telegram:** optional bot integration.

## 1. Prerequisites

The bare-metal application installer expects:

- Debian/Linux with systemd
- Node.js 20 or newer
- npm
- Python 3 with `venv`
- `curl`
- OpenSSL
- A working local Supabase API + Storage endpoint
- PostgreSQL behind that Supabase layer

The application itself listens only on loopback. Do not expose ports `3004` or `8081` directly to the Internet.

### Verify the server tools

```bash
node --version
npm --version
python3 --version
python3 -m venv --help
systemctl --version
```

If `python3 -m venv` fails on Debian, install the matching `python3-venv` package before continuing.

## 2. Get the repository

```bash
cd ~/projects
git clone https://github.com/adourix/recipe-box-local-deployment.git
cd recipe-box-local-deployment
git checkout local-deployment
```

If the repository already exists:

```bash
cd ~/projects/recipe-box-local-deployment
git pull origin local-deployment
```

## 3. Configure `.env`

```bash
cp .env.example .env
bash scripts/generate-local-keys.sh
chmod 600 .env
```

Set the real values in `.env`.

### Required application values

- `SUPABASE_URL`: URL used by the server-side Next.js process. Bare-metal default is `http://127.0.0.1:8000`.
- `SUPABASE_PUBLIC_URL`: browser-reachable Supabase origin. For a LAN deployment this can be the server LAN IP.
- `NEXT_PUBLIC_SUPABASE_URL`: same browser-reachable origin. Do not use `127.0.0.1` unless the browser itself is on the same machine.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service-role key.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser-safe anon key.
- `GEMINI_API_KEY`: required for recipe extraction.
- `RESOLVER_SECRET`: shared only between Recipe Box and the local resolver.
- `EDIT_KEY` and `CRON_SECRET`: generated application secrets.
- `APP_BASE_URL`: URL users open, for example `https://recipes.example.com` in the public deployment.
- `INTERNAL_APP_URL=http://127.0.0.1:3004`: used for local worker self-calls.
- `RESOLVER_URL=http://127.0.0.1:8081`.

### Resolver cookies

For Netscape-format cookies, prefer a file rather than putting multiline cookie data in `.env`:

```env
RESOLVER_COOKIES_FILE=/home/abdulrahman/projects/recipe-box-local-deployment/secrets/resolver-cookies.txt
```

Keep that file readable only by the service user:

```bash
chmod 600 secrets/resolver-cookies.txt
```

`RESOLVER_COOKIES` remains supported for simple one-line cookie content.

## 4. Database and Supabase schema

The application requires the migration at:

```text
supabase/migrations/20261014000100_initial_schema.sql
```

It creates:

- `recipes`
- `jobs`
- `worker_lock`
- `app_kv`
- `recipe-images` Storage bucket
- the required indexes, trigger, grants, and RLS policy

Apply this migration **to the PostgreSQL database used by the local Supabase layer**, not to an unrelated database.

For example, when the local PostgreSQL instance is reachable directly:

```bash
psql -h 127.0.0.1 -p 5432 -U <postgres-user> -d <postgres-db> \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261014000100_initial_schema.sql
```

The migration expects the Supabase Storage schema (`storage.*`) to already exist. PostgreSQL alone is therefore not enough; the local Supabase API/Storage layer must be installed first.

Do not expose PostgreSQL port `5432` publicly.

## 5. Install Recipe Box and Resolver

From the repository root:

```bash
sudo bash scripts/install-bare-metal.sh
```

The installer:

1. Verifies Node.js/Python/systemd prerequisites.
2. Generates missing application secrets without replacing existing ones.
3. Creates `services/recipe-resolver/.venv`.
4. Installs resolver Python dependencies.
5. Runs `npm ci`.
6. Runs TypeScript checks.
7. Runs the test suite.
8. Runs the production Next.js build.
9. Installs `recipe-resolver.service` and `recipe-box.service`.
10. Enables both services at boot.
11. Performs local health checks.

The installer does **not** install or modify PostgreSQL, Supabase, Nginx, or Cloudflare Tunnel.

### Services

```bash
sudo systemctl status recipe-resolver.service
sudo systemctl status recipe-box.service
```

Logs:

```bash
journalctl -u recipe-resolver.service -f
journalctl -u recipe-box.service -f
```

Manual health checks:

```bash
curl -fsS http://127.0.0.1:8081/health
curl -fsS http://127.0.0.1:3004/api/health
```

Expected application health response:

```json
{"ok":true,"service":"recipe-box"}
```

## 6. Local end-to-end checks

Before adding Nginx or Cloudflare, verify:

```bash
curl -fsS http://127.0.0.1:3004/api/health
curl -fsS http://127.0.0.1:8081/health
```

Then verify the Supabase API separately. The exact URL depends on the local Supabase installation, but it must provide the REST and Storage endpoints expected by `@supabase/supabase-js`.

Also verify that the `recipe-images` bucket exists and is public for browser image reads.

## 7. Nginx

The server already uses `127.0.0.1:8080` for Cloudflare Tunnel ingress. The repository includes an example at:

```text
deploy/nginx/recipe-box.conf
```

Install it as a normal Nginx site and replace `recipes.example.com` with the real hostname.

Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

The intended route is:

```text
recipes.example.com
        |
Cloudflare Tunnel
        |
Nginx :8080
        |
Recipe Box :3004
```

Do not change the existing Lingo Store host routes.

## 8. Cloudflare Tunnel

Use the existing Cloudflare Tunnel. Add a route similar to:

```yaml
- hostname: recipes.example.com
  service: http://127.0.0.1:8080
```

If the Recipe Box is public, the browser also needs a browser-reachable Supabase URL. Use a separate hostname for the Supabase API/Storage layer, for example:

```text
supabase.example.com
```

Then set:

```env
SUPABASE_PUBLIC_URL=https://supabase.example.com
NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com
```

Do not expose PostgreSQL and never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.

## 9. Telegram (optional)

Once the public Recipe Box hostname works, configure the Telegram webhook:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-recipes-host>/api/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d "drop_pending_updates=true" \
  -d 'allowed_updates=["message","channel_post"]'
```

Set `ALLOWED_TELEGRAM_USER_ID` to the numeric Telegram user ID allowed to use the bot.

## 10. Updating the deployment

```bash
cd ~/projects/recipe-box-local-deployment
git pull origin local-deployment
sudo bash scripts/install-bare-metal.sh
```

The installer rebuilds the application and restarts both services.

If you only changed environment values:

```bash
sudo systemctl restart recipe-resolver.service
sudo systemctl restart recipe-box.service
```

If `NEXT_PUBLIC_SUPABASE_URL` changes, rebuild the Next.js application because `NEXT_PUBLIC_*` values are embedded into the client bundle during the build.

## 11. Security checklist

- Keep `.env` at mode `600`.
- Keep resolver cookie files at mode `600`.
- Do not expose port `5432`.
- Do not expose port `8081`.
- Keep Recipe Box bound to `127.0.0.1:3004`.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
- Use HTTPS for public browser access.
- Keep the resolver secret private.
- Do not put real secrets into Git.

## 12. Legacy Docker path

`Dockerfile` and `docker-compose.yml` are retained for compatibility with the earlier self-hosted deployment. They are not required for the primary bare-metal path and should not be started on a server where Docker is intentionally disabled.

## 13. CI

The `local-deployment` workflow verifies:

```text
npm ci
npm run lint
npm test
npm run build
Python resolver dependency installation
Python resolver syntax compilation
```

The CI environment does not contain the production Supabase credentials and does not attempt to deploy the server.

## External dependency

The application is self-hosted but not fully offline. Gemini remains an external API for recipe extraction. Social-media access can also change independently of the server; Instagram and other platforms may require current cookies or may block automated access.
