import * as http from "http";
import { createBot } from "./index";
import { runMonitorScan } from "./services/monitorScan";
import { config, transitionEnabled, vercelWebhookUrl } from "./config";
import { dbExportAll, dbImportAll } from "./services/db";

// Render entry point: an always-on web service.
//
// Two modes (auto-detected):
//  - Transition mode (VERCEL_URL + RENDER_URL set): Vercel owns the Telegram
//    webhook while Render is down/warming. Render stays in STANDBY (health +
//    monitor + storage sync, but NO long-polling) until Vercel deletes the
//    webhook (a "green light" handoff). Then Render takes over with
//    bot.start(). Render batches its JSON storage to Vercel -> Supabase and
//    re-imports the snapshot on boot (Render free disk is ephemeral).
//  - Standalone (no URLs): legacy behaviour, delete webhook + long-poll at boot.

const bot = createBot();

let scanning = false;
async function runLoop(trigger: string): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const result = await runMonitorScan(bot);
    console.log(`[monitor:${trigger}] ok=${result.ok} processed=${result.processed} message=${result.message || ""}`);
  } catch (error) {
    console.error(`[monitor:${trigger}] error:`, error);
  } finally {
    scanning = false;
  }
}

// --- storage bridge (Render <-> Vercel <-> Supabase) -----------------------------------

async function pushSnapshot(reason: string): Promise<void> {
  if (!transitionEnabled) return;
  try {
    const snapshot = await dbExportAll();
    const url = `${config.vercelUrl}/api/sync?key=${config.monitorSecret}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot }),
      signal: AbortSignal.timeout(20000),
    });
    console.log(`[sync:${reason}] push=${res.status}`);
  } catch (e: any) {
    console.error(`[sync:${reason}] push error:`, String(e?.message || e));
  }
}

async function pullSnapshot(): Promise<void> {
  if (!transitionEnabled) return;
  try {
    const url = `${config.vercelUrl}/api/sync?key=${config.monitorSecret}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const json: any = await res.json();
    if (json?.ok && json.snapshot) {
      await dbImportAll(json.snapshot);
      console.log("[sync:pull] restored storage from Vercel (Supabase)");
    } else {
      console.log("[sync:pull] no remote snapshot yet; keeping local");
    }
  } catch (e: any) {
    console.error("[sync:pull] error:", String(e?.message || e));
  }
}

// On graceful shutdown (Render deploy / idle sleep) hand the webhook back to
// Vercel instantly so Vercel keeps serving while Render is down.
async function handBackToVercel(): Promise<void> {
  if (!transitionEnabled) return;
  try {
    if (pollingStarted) await bot.stop().catch(() => {});
    await bot.api.setWebhook(vercelWebhookUrl(), {
      drop_pending_updates: true,
      allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post", "callback_query"],
    }).catch(() => {});
    console.log("[mode] webhook handed back to Vercel");
  } catch (e: any) {
    console.error("[mode] handback failed:", String(e?.message || e));
  }
}

// --- HTTP server --------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (req.method === "GET" && (url === "/" || url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", running: true }));
    return;
  }
  if (req.method === "GET" && url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        running: true,
        mode: pollingStarted ? "polling" : "standby",
      })
    );
    return;
  }
  if (req.method === "GET" && url === "/refresh") {
    if (!config.monitorSecret) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MONITOR_SECRET not configured" }));
      return;
    }
    const key = new URL(req.url as string, `http://localhost:${config.port}`).searchParams.get("key");
    if (key !== config.monitorSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const result = await runMonitorScan(bot);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }
  if (req.method === "POST" && url === "/handoff") {
    // Called by Vercel after it deleted the webhook -> start long-polling now.
    if (!config.monitorSecret) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MONITOR_SECRET not configured" }));
      return;
    }
    const key = new URL(req.url as string, `http://localhost:${config.port}`).searchParams.get("key");
    if (key !== config.monitorSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    void beginPolling("handoff");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "handoff-accepted" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

let pollingStarted = false;

// In transition mode Render never polls until Vercel hands off; in standalone
// mode it polls immediately. Idempotent so /handoff can be hit repeatedly.
async function beginPolling(source: string): Promise<void> {
  if (pollingStarted) return;
  pollingStarted = true;
  console.log(`[bot] begin polling (source=${source})`);
  await bot.api.deleteWebhook({ drop_pending_updates: true }).catch((e: any) =>
    console.error(`[bot] deleteWebhook failed: ${String(e?.message || e)}`)
  );
  console.log("[bot] starting long-polling");
  bot
    .start()
    .then(() => console.log("[bot] polling stopped"))
    .catch((e: any) => {
      console.error(`[bot] start failed: ${String(e?.message || e)}`);
      pollingStarted = false;
    });
}

async function main(): Promise<void> {
  server.listen(config.port, () => {
    console.log(`[server] health endpoint listening on port ${config.port}`);
  });

  const envCheck = ["BOT_TOKEN", "ADMIN_IDS", "TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_SESSION"]
    .map((k) => `${k}=${process.env[k] ? "SET" : "EMPTY"}`)
    .join(" | ");
  const parsedCheck = `apiId=${typeof config.telegramApiId === "number" && config.telegramApiId > 0 ? "valid-number" : "INVALID"} | apiHash=${config.telegramApiHash?.length || 0} chars | session=${config.telegramSession?.length || 0} chars`;
  console.log(`[env] ${envCheck}`);
  console.log(`[env:parsed] ${parsedCheck}`);
  console.log(`[mode] transition=${transitionEnabled ? `vercel=${config.vercelUrl} render=${config.renderUrl}` : "standalone"}`);

  if (transitionEnabled) {
    // Restore truth from Vercel (Supabase) before serving anything.
    await pullSnapshot();
    // Keep Render's disk mirrored to Supabase at all times.
    const syncTimer = setInterval(() => pushSnapshot("timer"), config.syncIntervalMs);
    syncTimer.unref();
    console.log(`[sync] will push snapshot every ${config.syncIntervalMs}ms`);
    // Standby: Vercel owns the webhook; we only start polling on /handoff.
  } else {
    console.log("[bot] standalone: polling immediately");
    void beginPolling("boot");
  }

  // First scan shortly after boot, then on the configured timer.
  setTimeout(() => runLoop("boot"), 5000).unref();
  setInterval(() => runLoop("timer"), config.monitorIntervalMs).unref();
}

process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM received, shutting down");
  server.close();
  await pushSnapshot("shutdown").catch(() => {});
  await handBackToVercel();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[server] SIGINT received, shutting down");
  server.close();
  await pushSnapshot("shutdown").catch(() => {});
  await handBackToVercel();
  process.exit(0);
});

main().catch((error) => {
  console.error("[server] fatal error:", error);
  process.exit(1);
});

export { vercelWebhookUrl };