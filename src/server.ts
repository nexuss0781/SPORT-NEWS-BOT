import * as http from "http";
import { createBot } from "./index";
import { runMonitorScan } from "./services/monitorScan";
import { config } from "./config";

// Render entry point: an always-on web service.
//
// - The bot runs in long-polling mode (grammy `bot.start()`), so there are no
//   webhook/cold-start headaches — Telegram pushes updates over one connection.
// - The monitor scan runs in-process on a timer instead of a serverless cron,
//   so reels get picked up automatically every `monitorIntervalMs`.
// - A tiny HTTP server on `PORT` (required by Render) answers health checks.

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

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (req.method === "GET" && (url === "/" || url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", running: true }));
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
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

async function main(): Promise<void> {
  server.listen(config.port, () => {
    console.log(`[server] health endpoint listening on port ${config.port}`);
  });

  const envCheck = ["BOT_TOKEN", "ADMIN_IDS", "TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_SESSION"]
    .map((k) => `${k}=${process.env[k] ? "SET" : "EMPTY"}`)
    .join(" | ");
  const parsedCheck = `apiId=${JSON.stringify(process.env.TELEGRAM_API_ID)} | apiHash=${JSON.stringify(process.env.TELEGRAM_API_HASH)} | sessionLen=${process.env.TELEGRAM_SESSION?.length} | sessionPrefix=${JSON.stringify((process.env.TELEGRAM_SESSION || "").slice(0, 6))}`;
  console.log(`[env] ${envCheck}`);
  console.log(`[env:parsed] ${parsedCheck}`);

  // First scan shortly after boot, then on the configured timer.
  setTimeout(() => runLoop("boot"), 5000).unref();
  setInterval(() => runLoop("timer"), config.monitorIntervalMs).unref();

  // Telegram long-polling. First clear any leftover webhook (e.g. from the old
  // Vercel deploy) — Telegram refuses getUpdates while a webhook is active.
  await bot.api.deleteWebhook({ drop_pending_updates: true }).catch((e: any) =>
    console.error(`[bot] deleteWebhook failed: ${String(e?.message || e)}`)
  );
  await bot.start();
  console.log("[bot] started in long-polling mode");
}

process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM received, shutting down");
  server.close();
  await bot.stop();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[server] SIGINT received, shutting down");
  server.close();
  await bot.stop();
  process.exit(0);
});

main().catch((error) => {
  console.error("[server] fatal error:", error);
  process.exit(1);
});