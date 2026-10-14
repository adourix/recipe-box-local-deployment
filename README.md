# كتاب وصفات أمير — Recipe Box

Personal Arabic recipe manager. Share a social-media link, video, photo, or text with Telegram to extract and save recipes in Arabic, then browse/search the recipe gallery.

This branch adds a self-hosted deployment path. The original `main` branch and its hosted deployment instructions remain unchanged.

## Components

- **Recipe Box:** Next.js 15 app, published on host loopback port `3004`.
- **Supabase:** use the separate self-hosted Supabase Docker stack in `~/projects/recipe-supabase` (Postgres, PostgREST, Storage, and API gateway). Apply the migration in `supabase/migrations` to that database.
- **Recipe Resolver:** local Python/yt-dlp service, accessible only over the internal Docker network.
- **Gemini:** external API used for recipe extraction; set `GEMINI_API_KEY`.
- **Telegram:** optional; configure a bot and webhook to use link/photo/video capture.

## Important networking note

The app container must reach the Supabase API gateway. If your Supabase gateway is published on the Debian host at port `54321`, set `SUPABASE_URL=http://host.docker.internal:54321` and ensure the app container resolves `host.docker.internal` to the host gateway. On Linux Docker Compose, add this to the `app` service if it is not already configured:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

The browser-facing `NEXT_PUBLIC_SUPABASE_URL` must be reachable from the browser device. For use on the same machine set it to `http://localhost:54321`; for LAN access use the Debian server's LAN IP and port. For Cloudflare Tunnel, use your public hostname only after the local setup works.

## 1. Configure the Supabase stack

Start the separate Supabase Compose stack first, and ensure the gateway is listening on host port `54321`. Do not start duplicate Postgres or Storage services from this repository.

Apply the schema migration to the Supabase database (using the Supabase SQL editor, `psql`, or your existing migration workflow):

```bash
psql "$LOCAL_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261014000100_initial_schema.sql
```

Replace `$LOCAL_SUPABASE_DB_URL` with the connection string for the self-hosted Supabase Postgres database. Do not use an anon key for direct SQL.

The migration creates `recipes`, `jobs`, `worker_lock`, and `app_kv`, and the public `recipe-images` Storage bucket. It preserves private recipe notes by excluding `notes` from anon column grants.

Your Supabase API keys must match the JWT secret and generated anon/service role keys in the Supabase `.env`. Do not invent keys or copy the example placeholders.

## 2. Configure Recipe Box

```bash
git clone https://github.com/adourix/recipe-box-local-deployment.git
cd recipe-box-local-deployment
git checkout local-deployment
cp .env.example .env
```

Open `.env` and set:
- `SUPABASE_URL`: API gateway URL that is reachable **from the app container**.
- `NEXT_PUBLIC_SUPABASE_URL`: API gateway URL reachable **from the browser**.
- `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: keys generated for your own Supabase deployment.
- `GEMINI_API_KEY`: Gemini API key, required for extraction.
- `RESOLVER_SECRET`: same long random secret for Recipe Box and the resolver.
- `EDIT_KEY` and `CRON_SECRET`: separate random secrets.
- Telegram values only when enabling Telegram.

Generate app secrets without printing them:

```bash
bash scripts/generate-local-keys.sh
```

The script writes missing/replacement secrets to `.env` and sets file permissions to owner-only. It does not generate Supabase JWT/API keys.

## 3. Start the app and resolver

Make sure the existing Supabase Compose network is named `recipe-supabase_default`; adjust the external network name in `docker-compose.yml` if your Compose project uses a different name.

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f app recipe-resolver
```

Open `http://localhost:3004`. On a remote server, test from the server with `curl -I http://127.0.0.1:3004`; the port is intentionally bound to loopback for reverse-proxy use.

## 4. Nginx / Cloudflare Tunnel

Reverse proxy your desired hostname to `http://127.0.0.1:3004`. Keep existing Lingo Store virtual hosts intact. For browser API requests, make sure the public Supabase URL is reachable over the hostname/IP that browsers use.

## 5. Telegram webhook (optional)

The webhook needs a publicly reachable HTTPS URL. Configure the bot webhook once your domain/tunnel route is active:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${APP_BASE_URL}/api/telegram" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d "drop_pending_updates=true" \
  -d 'allowed_updates=["message","channel_post"]'
```

In the current Telegram handler, `ALLOWED_TELEGRAM_USER_ID` limits the bot to the owner when set.

## Updates and validation

```bash
git pull origin local-deployment
docker compose build --no-cache
docker compose up -d
docker compose logs --tail=200 app recipe-resolver
```

The background helper now uses the persistent Node.js event loop instead of Vercel `waitUntil`. This is appropriate for long-lived Docker/systemd services, but in-flight background tasks can be interrupted by a process crash or restart. A durable external job runner would be a later hardening step.

## Original project notes

Recipe extraction is driven by Gemini. For non-YouTube social video links, the resolver uses yt-dlp and may need fresh Instagram cookies (Netscape format) in `RESOLVER_COOKIES`. Social platforms can change their access controls at any time, so self-hosting does not guarantee every private/blocked reel can be extracted.

The rest of the application supports Arabic-normalized search, tags/collections, serving scaling, nutrition estimates, cook mode, notes/rating/favorites/cooked state, ingredient sections, print/copy, JSON backup export, dark mode, and installable PWA support.
