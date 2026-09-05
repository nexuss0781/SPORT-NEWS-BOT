import { Bot } from "grammy";
import { config } from "../src/config";
import { MediaPayload } from "../src/services/publisher";
import {
  getChannels,
  getTargetChannels,
  getConfig,
  isProcessed,
  getReelById,
  updateReel,
  markAsProcessed,
} from "../src/services/storage";
import {
  createMonitorClient,
  fetchRecentMessages,
  resolveChannelMeta,
  downloadMedia,
  fetchGroupedMedia,
} from "../src/services/mtproto";
import { processAndPublish } from "../src/services/publisher";
import { enqueueReel } from "../src/services/reels";
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

    const cfg = await getConfig();
    const reelsMode = !!cfg.reelsMode;
    const now = Math.floor(Date.now() / 1000);

    for (const ch of channels) {
      const messages = await fetchRecentMessages(client, ch.username, 10);

      for (const msg of messages) {
        if (await isProcessed(ch.username, msg.messageId)) continue;
        if (now - msg.date > LOOKBACK_SECONDS) continue;

        const cleaned = cleanContent(msg.text);
        if (!cleaned && !msg.hasMedia) continue;

        try {
          if (reelsMode) {
            // Collapse albums: only the earliest message of a groupedId becomes a reel.
            const isEarliestInGroup = !msg.raw?.groupedId;
            const groupedMsgs = msg.raw?.groupedId
              ? await fetchGroupedMedia(client, ch.username, msg.messageId, msg.raw.groupedId)
              : [];
            if (groupedMsgs.length > 0) {
              const minId = Math.min(...groupedMsgs.map((m: any) => m.id ?? Number.MAX_SAFE_INTEGER));
              if (msg.messageId > minId) {
                results.push({ channel: ch.username, messageId: msg.messageId, ok: true, skipped: "album item" });
                await markAsProcessed({
                  channelId: ch.username,
                  messageId: msg.messageId,
                  originalText: cleaned,
                  translatedText: cleaned,
                  englishText: cleaned,
                  sourceLang: "en",
                  processedAt: new Date().toISOString(),
                });
                continue;
              }
            }

            // Check the post's own metadata first: who the channel is + official link
            const meta = await resolveChannelMeta(client, msg.raw, msg.messageId);
            let groupedMedia: MediaPayload[] = [];
            for (const m of groupedMsgs) {
              const p = await downloadMedia(client, m);
              if (p) groupedMedia.push(p);
            }
            await enqueueReel({
              channelId: ch.username,
              messageId: msg.messageId,
              text: cleaned,
              hasMedia: msg.hasMedia || groupedMedia.length > 0,
              entities: msg.raw?.entities,
              sourceLink: meta.sourceLink,
              channelTitle: meta.channelTitle,
              groupedId: msg.raw?.groupedId,
            });
            // Store grouped media on the reel
            if (groupedMedia.length > 0) {
              const reelId = `${ch.username}:${msg.messageId}`;
              const reel = await getReelById(reelId);
              if (reel) {
                await updateReel(reel.id, { sourceGroupedMedia: groupedMedia });
              }
            }
          } else {
            // Albums post as a single grouped media message; other items are
            // skipped so the album isn't split/reposted.
            let album: MediaPayload[] = [];
            let isEarliest = true;
            let groupedMsgs: any[] = [];
            if (msg.raw?.groupedId) {
              groupedMsgs = await fetchGroupedMedia(client, ch.username, msg.messageId, msg.raw.groupedId);
              if (groupedMsgs.length > 0) {
                const minId = Math.min(...groupedMsgs.map((m: any) => m.id ?? Number.MAX_SAFE_INTEGER));
                isEarliest = msg.messageId <= minId;
                if (isEarliest) {
                  for (const m of groupedMsgs) {
                    const p = await downloadMedia(client, m);
                    if (p) album.push(p);
                  }
                }
              }
            }
            if (!isEarliest) {
              results.push({ channel: ch.username, messageId: msg.messageId, ok: true, skipped: "album item" });
              await markAsProcessed({
                channelId: ch.username,
                messageId: msg.messageId,
                originalText: cleaned,
                translatedText: cleaned,
                englishText: cleaned,
                sourceLang: "en",
                processedAt: new Date().toISOString(),
              });
              continue;
            }
            const media = msg.hasMedia ? await downloadMedia(client, msg.raw) : null;
            const copySourceIds =
              msg.hasMedia && msg.raw?.groupedId
                ? groupedMsgs.map((m: any) => m.id as number).sort((a: number, b: number) => a - b)
                : msg.hasMedia
                  ? [msg.messageId]
                  : undefined;
            await processAndPublish(
              bot.api as any,
              ch.username,
              msg.messageId,
              cleaned,
              media,
              album.length > 1 ? album : undefined,
              copySourceIds
            );
          }
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