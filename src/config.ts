import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// ADMIN_IDS accepts numeric Telegram ids and/or @usernames, e.g. "123456,@me".
// Numeric ids are checked directly; usernames are matched case-insensitively
// against ctx.from.username (no @ prefix) when a message comes in.
const rawAdminIds = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const config = {
  botToken: process.env.BOT_TOKEN || "",
  adminIds: rawAdminIds
    .map((id) => parseInt(id, 10))
    .filter((id) => !isNaN(id)),
  adminUsernames: rawAdminIds
    .filter((id) => isNaN(parseInt(id, 10)))
    .map((u) => u.replace(/^@/, "").toLowerCase()),
  dataDir: process.env.DATA_DIR || "./data",
  telegramApiId: Number(process.env.TELEGRAM_API_ID || 0),
  telegramApiHash: process.env.TELEGRAM_API_HASH || "",
  telegramSession: process.env.TELEGRAM_SESSION || "",
  monitorSecret: process.env.MONITOR_SECRET || "",
  // Health-check + optional monitor-trigger HTTP port (Render uses PORT).
  port: Number(process.env.PORT || 3000),
  // How often the in-process monitor loop scans source channels (ms).
  monitorIntervalMs: Number(process.env.MONITOR_INTERVAL_MS || 5 * 60 * 1000),
  // Transition mode: Vercel holds the Telegram webhook and only hands off to
  // Render (long-polling) once Render is green; Render batches storage back to
  // Vercel -> Supabase. Both URLs are required to enable it.
  // NOTE: named PUBLIC_BASE_URL (not VERCEL_URL) because Vercel auto-injects
  // VERCEL_URL with the deployment URL, which would clobber our stable domain.
  vercelUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
  renderUrl: (process.env.RENDER_URL || "").replace(/\/+$/, ""),
  // How often Render pushes a storage snapshot to Vercel -> Supabase (ms).
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS || 5 * 60 * 1000),
} as const;

export const transitionEnabled = Boolean(config.vercelUrl && config.renderUrl);

export function vercelWebhookUrl(): string {
  return `${config.vercelUrl}/api/bot`;
}

export function isAdmin(userId: number | undefined): boolean {
  if (!userId) return false;
  return config.adminIds.includes(userId);
}