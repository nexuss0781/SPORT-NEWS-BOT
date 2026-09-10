import { config as dotenvConfig } from "dotenv";

dotenvConfig();

export const config = {
  botToken: process.env.BOT_TOKEN || "",
  adminIds: (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id)),
  dataDir: process.env.DATA_DIR || "./data",
  telegramApiId: Number(process.env.TELEGRAM_API_ID || 0),
  telegramApiHash: process.env.TELEGRAM_API_HASH || "",
  telegramSession: process.env.TELEGRAM_SESSION || "",
  monitorSecret: process.env.MONITOR_SECRET || "",
  // Health-check + optional monitor-trigger HTTP port (Render uses PORT).
  port: Number(process.env.PORT || 3000),
  // How often the in-process monitor loop scans source channels (ms).
  monitorIntervalMs: Number(process.env.MONITOR_INTERVAL_MS || 5 * 60 * 1000),
} as const;

export function isAdmin(userId: number | undefined): boolean {
  if (!userId) return false;
  return config.adminIds.includes(userId);
}