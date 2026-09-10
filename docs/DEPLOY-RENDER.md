# Deploy: Vercel on top of Render (free tiers)

The bot runs on **two platforms at once** to survive both free-tier failure modes:

| Failure mode | Consequence | Fix |
|---|---|---|
| Render free sleeps after ~15 min of no **inbound** traffic (even while long-polling) | Bot stops answering while "warm" | Vercel (always-on webhook) wakes Render and takes over instantly |
| Render free filesystem is **ephemeral** (resets on cold start / redeploy) | All state lost | Render batches its storage to Vercel -> Supabase every 5 min and re-imports on boot |

## How it works

- **Telegram webhook -> Vercel** (`api/bot`). Vercel answers immediately — no cold start.
- On the first call, Vercel kicks `/api/wake` (fire-and-forget) which:
  1. hits Render's `/` endpoint (this **wakes** it),
  2. polls until Render returns `{"status":"ok","running":true}` (the green light),
  3. deletes the webhook and POSTs `/handoff` to Render.
- Render then starts **long-polling** (`bot.start()`) and owns updates — the transition is
  seamless to users.
- Render **batches its storage snapshot** to Vercel `/api/sync` every `SYNC_INTERVAL_MS`;
  Vercel persists it to **Supabase** (single `bot_state` row). Render re-imports the snapshot
  on boot, so a fresh filesystem is transparently recovered.
- **Self-healing:** GitHub Actions pings Vercel `/api/monitor` every 5 min. If Render is not
  green, Vercel reclaims the webhook (`vercel-owns`) and serves until Render wakes again.

## 0. Supabase setup (one-time)

1. Create a Supabase project (free).
2. Run this in the **SQL editor** (see `docs/supabase.sql`):

```sql
create table if not exists bot_state (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
```

3. Copy the **project URL** and **service_role key** (Settings > API). These go on Vercel,
   not Render.

## 1. Vercel deployment

1. Push this repo to GitHub, then import it on Vercel (**New Project**).
   It is a Node serverless functions project: `api/bot.ts`, `api/wake.ts`, `api/reconcile.ts`,
   `api/monitor.ts`, `api/sync.ts`. No build command needed beyond `npm run build` (types only).
2. Set the project's environment variables (Vercel > Settings > Environment Variables):

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | your Telegram bot token |
| `ADMIN_IDS` | comma-separated Telegram user IDs (owners/admins) |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION` | if Vercel should do MTProto work while Render is warming |
| `MONITOR_SECRET` | **same** secret as Render (guards `/api/wake|reconcile|monitor|sync`) |
| `PUBLIC_BASE_URL` | `https://sport-news-bot.vercel.app` (your stable Vercel domain) |
| `RENDER_URL` | `https://sport-news-bot.onrender.com` |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase **service_role** key (server-only) |

> ⚠️ Do **not** set `VERCEL_URL` (Vercel auto-injects it with the deployment URL, which would
> clobber the stable domain). The code reads `PUBLIC_BASE_URL` deliberately.

## 2. Render deployment

1. Render **New > Web Service** from the same repo.
   - Build: `npm install && npm run build`
   - Start: `npm start`
   - Instance: Free
2. Environment variables:

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | same as Vercel |
| `ADMIN_IDS` | same as Vercel |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION` | required (MTProto monitor + copy) |
| `MONITOR_SECRET` | **same** as Vercel (guards `/handoff`) |
| `DATA_DIR` | `./data` (snapshot sync makes ephemeral disk safe) |
| `MONITOR_INTERVAL_MS` | `300000` |
| `SYNC_INTERVAL_MS` | `300000` |
| `PORT` | `3000` |
| `PUBLIC_BASE_URL` | `https://sport-news-bot.vercel.app` |
| `RENDER_URL` | `https://sport-news-bot.onrender.com` |

## 3. Wire the webhook (one-time)

Both platforms are up, but nobody listens yet — claim the webhook for Vercel:

```bash
curl "https://sport-news-bot.vercel.app/api/monitor?key=YOUR_MONITOR_SECRET"
```

That reconciles: Render is waking -> Vercel sets its own webhook -> next wake hands off to
Render once green. Or set it directly:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://sport-news-bot.vercel.app/api/bot&allowed_updates=message&allowed_updates=edited_message&allowed_updates=channel_post&allowed_updates=edited_channel_post&allowed_updates=callback_query"
```

## 4. The green light

`https://sport-news-bot.onrender.com/` returns `{"status":"ok","running":true}` — that exact
payload is what Vercel waits for before handing over.

## 5. Local dev

Without `PUBLIC_BASE_URL`/`RENDER_URL` set, `transitionEnabled=false` and Render behaves as
before: delete webhook + long-poll immediately, no sync. `npm run dev` is unaffected.

## Related issues

- Telegram forbids webhook + getUpdates simultaneously (409). That is why Vercel
  **deletes** its webhook before Render starts polling, and why Render only starts on `/handoff`.
- Clean shutdown: Render hands the webhook back to Vercel on SIGTERM so Vercel keeps serving
  instantly during redeploys/sleep.