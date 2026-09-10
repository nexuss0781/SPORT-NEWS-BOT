import * as http from "http";
import { createBot } from "./index";
import { runMonitorScan } from "./services/monitorScan";
import { config, transitionEnabled, vercelWebhookUrl } from "./config";
import { pushSnapshot, pullSnapshot } from "./services/sync";

// Render entry point: an always-on web service.
//
// Two modes (auto-detected):
//  - Transition mode (VERCEL_URL + RENDER_URL set): Vercel owns the Telegram
//    webhook while Render is down/warming. Render stays in STANDBY (health +
//    monitor + storage sync, but NO long-polling) until Vercel calls /handoff.
//    Render then deletes the webhook itself and immediately starts long-polling
//    in the same process, so Telegram never has a moment without an owner
//    ("zero disruption"). Render batches its JSON storage to Vercel -> Supabase
//    and re-imports the snapshot on boot (Render free disk is ephemeral).
//  - Standalone (no URLs): legacy behaviour, delete webhook + long-poll at boot.
//
// Ownership invariant: Vercel only ever SETS the webhook (reclaim). Render only
// ever DELETES it, atomically, at the moment it starts polling.

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

// On graceful shutdown (Render deploy / idle sleep) hand the webhook back to
// Vercel instantly so Vercel keeps serving while Render is down.
async function handBackToVercel(): Promise<void> {
  if (!transitionEnabled) return;
  try {
    if (pollingStarted) await bot.stop().catch(() => {});
    await bot.api.setWebhook(vercelWebhookUrl(), {
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
    res.end(JSON.stringify({ status: "ok", running: pollingStarted }));
    return;
  }
  if (req.method === "GET" && url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        running: pollingStarted,
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
    // Called by Vercel. Render deletes the webhook ITSELF and starts polling
    // in the same process — until that delete lands, Vercel still owns, so
    // Telegram keeps delivering to Vercel. No dead window = zero disruption.
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
    await beginPolling("handoff").catch((e: any) =>
      console.error(`[mode] handoff beginPolling failed: ${String(e?.message || e)}`)
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "handoff-accepted", running: pollingStarted }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

let pollingStarted = false;

// In transition mode Render never polls until Vercel calls /handoff; in
// standalone mode it polls at boot. Idempotent so /handoff can be hit
// repeatedly, and each call re-deletes the webhook so Render re-takes control.
async function beginPolling(source: string): Promise<void> {
  // Take ownership: delete the webhook (Vercel still owns until now, so any
  // update in flight is safe — Telegram keeps it pending and delivers it to
  // Render's getUpdates). No drop_pending_updates: never throw away messages.
  await bot.api.deleteWebhook().catch((e: any) =>
    console.error(`[bot] deleteWebhook failed: ${String(e?.message || e)}`)
  );

  if (!pollingStarted) {
    pollingStarted = true;
    console.log(`[bot] begin polling (source=${source})`);
    console.log("[bot] starting long-polling");
    bot
      .start()
      .then(() => console.log("[bot] polling stopped"))
      .catch((e: any) => {
        console.error(`[bot] start failed: ${String(e?.message || e)}`);
        pollingStarted = false;
        // Hand back to Vercel so it keeps answering while Render is broken.
        handBackToVercel();
      });
  }
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