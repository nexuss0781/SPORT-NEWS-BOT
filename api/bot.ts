import { VercelRequest, VercelResponse } from "@vercel/node";
import { webhookCallback } from "grammy";
import { createBot } from "../src/index";
import { MONITOR_SECRET, PUBLIC_BASE_URL } from "./_shared";

// Vercel Telegram webhook.
//  - webhookMode: creates a bot that only answers users (no channel_post
//    handling — that's Render's monitor loop's job).
//  - The user's reply is fully delivered inside callback(). AFTER that, we
//    kick /api/wake so Render warms up and takes over polling. The user is
//    never delayed: Vercel serves while Render wakes, and Render deletes the
//    webhook itself the moment it starts polling (zero disruption).
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