import { config as dotenvConfig } from "dotenv";

dotenvConfig();

export const config = {
  botToken: process.env.BOT_TOKEN || "",
  adminIds: (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id)),
  vercelUrl: process.env.VERCEL_URL || "",
  vercelEnv: process.env.VERCEL_ENV || "development",
  dataDir: "./data",
} as const;

export function isAdmin(userId: number | undefined): boolean {
  if (!userId) return false;
  return config.adminIds.includes(userId);
}
