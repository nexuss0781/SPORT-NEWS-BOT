import { Bot } from "grammy";
import { config } from "../src/config";
import {
  getChannels,
  getTargetChannels,
  isProcessed,
} from "../src/services/storage";
import {
  createMonitorClient,
  fetchRecentMessages,
  downloadMedia,
} from "../src/services/mtproto";
import { processAndPublish } from "../src/services/publisher";
import { cleanContent } from "../src/services/cleaner";

// Light-weight bot instance just for posting to the target channel
const bot = new Bot(config.botToken);

// Only process source posts within this window (seconds) so a cold start
// (where /tmp state is lost) does not re-publish old posts.
const LOOKBACK_SECONDS = 1800; // 30 minutes

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

  const results: any[] = [];
  let client: any = null;

  try {
    const channels = await getChannels();
    const targets = await getTargetChannels();

    if (!channels.length || targets.length === 0) {
      res.status(200).json({ ok: true, message: "No channels or target configured" });
      return;
    }

    client = createMonitorClient();
    await client.connect();

    const now = Math.floor(Date.now() / 1000);

    for (const ch of channels) {
      const messages = await fetchRecentMessages(client, ch.username, 10);

      for (const msg of messages) {
        if (await isProcessed(ch.username, msg.messageId)) continue;
        if (now - msg.date > LOOKBACK_SECONDS) continue;

        const cleaned = cleanContent(msg.text);
        if (!cleaned && !msg.hasMedia) continue;

        try {
          const media = msg.hasMedia ? await downloadMedia(client, msg.raw) : null;
          await processAndPublish(bot.api as any, ch.username, msg.messageId, cleaned, media);
          results.push({ channel: ch.username, messageId: msg.messageId, ok: true });
        } catch (error: any) {
          results.push({
            channel: ch.username,
            messageId: msg.messageId,
            ok: false,
            error: String(error?.errorMessage || error?.message || error),
          });
        }
      }
    }

    res.status(200).json({ ok: true, processed: results.length, results });
  } catch (error: any) {
    console.error("Monitor error:", error);
    res.status(500).json({ ok: false, error: String(error?.errorMessage || error?.message || error) });
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {}
    }
  }
}