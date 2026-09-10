import { Bot } from "grammy";
import { config } from "../src/config";
import { runMonitorScan } from "../src/services/monitorScan";

// Light-weight bot instance just for posting to the target channel
const bot = new Bot(config.botToken);

export default async function handler(req: any, res: any) {
  // Triggered by Vercel cron, or manually via GET/POST
  const isCron = req.headers?.["x-vercel-cron"] === "1";
  const keyMatch =
    !config.monitorSecret ||
    req.query?.key === config.monitorSecret ||
    isCron;

  if (!keyMatch) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  try {
    const result = await runMonitorScan(bot);
    res.status(200).json(result);
  } catch (error: any) {
    console.error("Monitor error:", error);
    res.status(500).json({ ok: false, error: String(error?.errorMessage || error?.message || error) });
  }
}