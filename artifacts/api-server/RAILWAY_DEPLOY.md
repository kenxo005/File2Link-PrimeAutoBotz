# Railway deployment guide — File2Link BOT

## 1. Create the project

1. New Project → "Deploy from GitHub repo" (push this monorepo to GitHub first).
2. Add the **PostgreSQL** plugin from Railway's marketplace and attach it to the service. Railway auto-injects `DATABASE_URL`.

## 2. Required environment variables

Set these on the service (Settings → Variables):

| Var | Value |
|---|---|
| `TELEGRAM_API_ID` | from https://my.telegram.org → API development tools |
| `TELEGRAM_API_HASH` | same place |
| `TELEGRAM_BOT_TOKEN` | main bot token from @BotFather |
| `PUSH_BOT_TOKEN` | push bot token from @BotFather (optional, but required for broadcasts) |
| `LOG_CHANNEL_ID` | id of the private channel both bots are admins of (e.g. `-1003949885436`) |
| `TELEGRAM_SESSION` | the StringSession from `telegram_session.txt` (see step 3) |
| `BASE_URL` | `https://<your-service>.up.railway.app` (set after first deploy) |
| `NODE_ENV` | `production` |

`PORT` and `DATABASE_URL` are injected automatically — do **not** set them manually.

## 3. Generate the GramJS user session locally

The MTProto streaming engine requires a *user* session (not just a bot token).
On your local machine, run the bot once with `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`
and `TELEGRAM_BOT_TOKEN` set. It will produce a `telegram_session.txt` file in
the project root. Copy its contents into the `TELEGRAM_SESSION` variable on
Railway.

> Railway containers have an ephemeral filesystem, so the session **must** live
> in an env var, not a file. The code reads `TELEGRAM_SESSION` first and
> falls back to the file only for local development.

## 4. Telegram setup checklist

- Both bots (main + push) must be **admins** of the log channel with at least
  the **Post Messages** permission.
- The Telegram user account whose session is in `TELEGRAM_SESSION` must be a
  **member** of the log channel — that's how MTProto can read the forwarded
  files for streaming.

## 5. Build / deploy commands

`railway.toml` at the repo root already contains:

```toml
[build]
builder = "nixpacks"
buildCommand = "corepack enable && pnpm install --frozen-lockfile && pnpm --filter @workspace/db run push-force && pnpm --filter @workspace/api-server run build"

[deploy]
startCommand = "pnpm --filter @workspace/api-server run start"
healthcheckPath = "/api/healthz"
healthcheckTimeout = 60
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10
```

The build step:
1. Enables `corepack` so pnpm matches the version pinned in `package.json`.
2. Installs deps from the lockfile.
3. Pushes the Drizzle schema to the freshly-attached Postgres.
4. Bundles the server with esbuild.

## 6. After first deploy

1. Open the generated Railway URL → confirm the homepage loads.
2. Set `BASE_URL` to that URL and redeploy (so download/stream links use the
   public host, not `localhost`).
3. DM the main bot a small file → confirm you get download + stream links.
4. DM the push bot a text or image → open any active stream page → confirm
   the broadcast appears.

## 7. Memory tips for the free tier

- `REQUEST_SIZE = 1 MB` × `WORKERS = 8` keeps per-stream memory under ~10 MB.
- The hourly cleanup job deletes expired (>24 h) files and broadcasts.
- Keep concurrent streams limited or upgrade the plan if you hit OOM.
