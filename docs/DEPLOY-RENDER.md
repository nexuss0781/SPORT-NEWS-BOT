# Deploy to Render (free tier, manual)

The bot now runs as an **always-on web service**: grammy long-polling (no webhook, no
cold starts), the monitor scan runs in-process on a timer, and all state is stored in
plain JSON files under `DATA_DIR` — **no Supabase, no Postgres, no serverless functions**.

## 1. Push this repo to GitHub

```bash
git add -A && git commit -m "render: persistent long-polling service, drop Supabase/Vercel" && git push origin master
```

## 2. Create the web service

1. Go to https://dashboard.render.com and click **New > Web Service**.
2. Connect your GitHub repo.
3. Settings:
   - **Name**: `sport-news-bot`
   - **Runtime**: Node
   - **Region**: Frankfort (eu) or nearest to you
   - **Branch**: `master`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. Click **Create Web Service**. It builds once, then stays running.

## 3. Set environment variables

Under your service's **Environment** tab add:

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | your Telegram bot token |
| `ADMIN_IDS` | comma-separated Telegram user IDs (owners/admins) |
| `TELEGRAM_API_ID` | from https://my.telegram.org |
| `TELEGRAM_API_HASH` | from https://my.telegram.org |
| `TELEGRAM_SESSION` | long-lived MTProto session string |
| `MONITOR_SECRET` | any secret; used by the optional `/refresh` HTTP endpoint |
| `DATA_DIR` | `./data` (on free tier the filesystem is ephemeral — see warning) |
| `MONITOR_INTERVAL_MS` | `300000` (5 min) |
| `PORT` | `3000` |

Click **Save Changes** (service redeploys on save).

## 4. First bot

Send the bot `/start`. It uses **long-polling**, so there is nothing to configure
for Telegram to reach it.

The monitor loop starts 5s after boot and then every `MONITOR_INTERVAL_MS`.
You can also force a scan with `/refresh` (owners only) or hit
`https://<service>.onrender.com/refresh?key=<MONITOR_SECRET>`.

## 5. Health checks (optional)

Render pings `/health`. No setup needed — the endpoint just returns `{"status":"ok"}`.

## Free tier limitations (important)

- **Storage is NOT persistent.** Every cold start (spin-down → wake, manual restart,
  redeploy) gets a **fresh filesystem**, so `data/*.json` resets. That means:
  source channels, targets, settings, and the queue are lost on restart.
- Because the bot long-polls Telegram 24/7 it usually stays warm and rarely
  restarts, but there is no guarantee.
- If you want state to survive restarts you have two painless options:
  1. Upgrade to Render **Starter** ($7/mo) and mount a **Persistent Disk** at the
     `DATA_DIR` path — everything then survives restarts automatically.
  2. Point `DATA_DIR` at a shared volume you run elsewhere. Not required to get started.

If you later go with a persistent disk, just change `DATA_DIR` to the disk mount path
(e.g. `/var/data`) and restart once.