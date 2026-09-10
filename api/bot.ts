import { VercelRequest, VercelResponse } from "@vercel/node";
import { webhookCallback } from "grammy";
import { createBot } from "../src/index";
import { MONITOR_SECRET, PUBLIC_BASE_URL } from "./_shared";

// Vercel Telegram webhook.
//  - webhookMode: creates a bot that only answers users (no channel_post
//    handling — that's Render's monitor loop's job).
//  - After replying, it kicks /api/wake fire-and-forget so Render gets
//    woken/takes over on the first real call.
const bot = createBot({ webhookMode: true });
const callback = webhookCallback(bot, "http");

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await callback(req, res);
  } catch (err: any) {
    console.error("[webhook] handler error:", err?.message || err);
    if (!res.writableEnded) res.status(200).send("ok");
    return;
  }

  // Wake + reconcile in the background so Render takes over quickly. We await
  // it (Vercel may otherwise terminate the invocation before the fetch fires).
  if (MONITOR_SECRET && PUBLIC_BASE_URL) {
    await fetch(`${PUBLIC_BASE_URL}/api/wake?key=${MONITOR_SECRET}`, {
      signal: AbortSignal.timeout(20000),
    }).catch((e) => console.error("[webhook] wake failed:", String(e?.message || e)));
  }
}