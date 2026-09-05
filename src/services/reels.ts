import { Bot } from "grammy";
import { addReel, getConfig, getReelById, getTargetChannels, updateReel, getQueuedReels } from "./storage";
import { translateToAmharic } from "./translator";
import {
  createMonitorClient,
  downloadMedia,
  fetchRawMessage,
  fetchGroupedMedia,
  resolveChannelMeta,
} from "./mtproto";
import { sendMedia, sendMediaGroup } from "./publisher";
import { BotConfig, CustomEmoji, MediaPayload, ReelItem } from "../types";

// Download source media for preview/posting
export async function downloadSourceMedia(
  channelId: string,
  sourceMessageId: number
): Promise<MediaPayload | undefined> {
  const client = createMonitorClient();
  try {
    await client.connect();
    const raw = await fetchRawMessage(client, channelId, sourceMessageId);
    if (!raw) return undefined;
    return await downloadMedia(client, raw);
  } catch (error: any) {
    console.error("[reels] source media download failed:", error?.message || error);
    return undefined;
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

// Check the post's own metadata and repair missing/broken channel + source link
// data on queued items before they are shown.
export async function ensureReelMeta(reel: ReelItem): Promise<void> {
  const hasValidLink = !!reel.sourceLink && reel.sourceLink.startsWith("http");
  const hasValidChannel = !!reel.channelTitle && !reel.channelId.includes("/");
  if (hasValidLink && hasValidChannel) return;

  const client = createMonitorClient();
  try {
    await client.connect();
    const raw = await fetchRawMessage(client, reel.channelId, reel.sourceMessageId);
    if (!raw) return;
    const meta = await resolveChannelMeta(client, raw, reel.sourceMessageId);
    const realUsername =
      meta.channelUsername && !meta.channelUsername.startsWith("http")
        ? `@${meta.channelUsername}`
        : reel.channelId;
    const updates: Partial<ReelItem> = {
      channelTitle: meta.channelTitle || reel.channelTitle,
      sourceLink: meta.sourceLink || reel.sourceLink,
      channelId: realUsername,
    };
    if (realUsername !== reel.channelId) {
      updates.id = `${realUsername}:${reel.sourceMessageId}`;
    }
    await updateReel(reel.id, updates);
  } catch (error: any) {
    console.error("[reels] metadata repair failed:", error?.message || error);
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

// Download all media in a grouped album for preview
export async function downloadGroupedMedia(
  channelId: string,
  sourceMessageId: number,
  groupedId: bigint | string
): Promise<MediaPayload[]> {
  const client = createMonitorClient();
  try {
    await client.connect();
    const msgs = await fetchGroupedMedia(client, channelId, sourceMessageId, groupedId);
    const payloads: MediaPayload[] = [];
    for (const m of msgs) {
      const payload = await downloadMedia(client, m);
      if (payload) payloads.push(payload);
    }
    return payloads;
  } catch (error: any) {
    console.error("[reels] grouped media download failed:", error?.message || error);
    return [];
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

export function encodeReelId(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

export function decodeReelId(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

// Capture premium (custom) emoji from a raw message so reposts retain them.
export function extractCustomEmoji(
  text: string,
  entities: any[] | undefined
): CustomEmoji[] {
  const out: CustomEmoji[] = [];
  const seen = new Set<string>();
  for (const e of entities || []) {
    const type = e?.type || e?.className;
    const isCustom =
      type === "custom_emoji" ||
      type === "MessageEntityCustomEmoji";
    if (!isCustom) continue;
    const emojiId =
      e?.custom_emoji_id ?? e?.customEmojiId ?? e?.documentId ?? e?.document_id;
    const offset = e?.offset ?? e?.offset_l;
    const length = e?.length ?? e?.length_l;
    if (emojiId == null || offset == null || length == null || length <= 0) continue;
    const emojiChar = String(text).substring(offset, offset + length);
    if (!emojiChar) continue;
    const key = `${emojiId}:${emojiChar}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ emojiChar, emojiId: String(emojiId) });
  }
  return out;
}

// Re-attach premium emoji entities wherever the emoji still exists in the final text.
export function buildEmojiEntities(
  content: string,
  list: CustomEmoji[]
): { type: string; offset: number; length: number; custom_emoji_id: string }[] {
  const out: { type: string; offset: number; length: number; custom_emoji_id: string }[] = [];
  for (const ce of list) {
    let idx = 0;
    while ((idx = content.indexOf(ce.emojiChar, idx)) !== -1) {
      out.push({
        type: "custom_emoji",
        offset: idx,
        length: ce.emojiChar.length,
        custom_emoji_id: ce.emojiId,
      });
      idx += ce.emojiChar.length;
    }
  }
  return out;
}

// Match-and-replace (line edit). The rest of the text stays intact; premium
// emoji retention is handled when re-attaching entities at send time.
export function patchText(
  current: string,
  oldText: string,
  newText: string
): string | null {
  const idx = current.indexOf(oldText);
  if (idx === -1) return null;
  return current.slice(0, idx) + newText + current.slice(idx + oldText.length);
}

export function buildReelCaption(item: ReelItem, cfg: BotConfig): string {
  let content: string;
  if (item.mode === "original") {
    content = item.originalText.trim();
  } else {
    const parts: string[] = [];
    if (
      cfg.showEnglish &&
      item.sourceLang &&
      item.sourceLang !== "en" &&
      item.englishText
    ) {
      parts.push(`🇬🇧 English:\n${item.englishText}\n`);
    }
    parts.push(item.translatedText.trim());
    content = parts.join("\n");
  }
  if (cfg.signature) {
    content =
      content.length > 0
        ? `${content}\n\n—\n${cfg.signature}`
        : `—\n${cfg.signature}`;
  }
  return content;
}

export interface ReelSourceInput {
  channelId: string;
  messageId: number;
  text: string;
  hasMedia: boolean;
  entities?: any[];
  sourceLink?: string;
  channelTitle?: string;
  groupedId?: bigint | string;
}

export async function enqueueReel(input: ReelSourceInput): Promise<boolean> {
  const ori = (input.text || "").trim();
  const customEmoji = extractCustomEmoji(ori, input.entities || []);

  let translation = { amharic: ori, english: ori, sourceLang: "en" };
  if (ori) {
    try {
      translation = await translateToAmharic(ori);
    } catch (error) {
      console.error("[reels] enqueue translation failed:", error);
    }
  }

  const item: ReelItem = {
    id: `${input.channelId}:${input.messageId}`,
    channelId: input.channelId,
    channelTitle: input.channelTitle,
    sourceMessageId: input.messageId,
    sourceLink: input.sourceLink,
    originalText: ori,
    translatedText: translation.amharic,
    englishText: translation.english,
    sourceLang: translation.sourceLang,
    mode: "translated",
    sourceMedia: input.hasMedia,
    sourceGroupedId: input.groupedId,
    sourceGroupedMedia: [],
    customEmoji,
    addedMedia: [],
    status: "queued",
    queuedAt: new Date().toISOString(),
  };
  return addReel(item);
}

export async function publishReelItem(
  bot: Bot,
  item: ReelItem
): Promise<{
  ok: boolean;
  error?: string;
  firstId?: number;
  ids?: Record<string, number>;
}> {
  try {
    const cfg = await getConfig();
    const targets = await getTargetChannels();
    if (!targets.length) return { ok: false, error: "No target channels configured." };

    const content = buildReelCaption(item, cfg);
    const emojiEntities = buildEmojiEntities(content, item.customEmoji);

    // Admin-attached media wins; otherwise re-download the original source media as-is.
    let media: MediaPayload | undefined = item.addedMedia[0];
    let album: MediaPayload[] = [];
    if (!media && item.sourceMedia) {
      media = await downloadSourceMedia(item.channelId, item.sourceMessageId);
    }
    // Albums (Bot API sendMediaGroup): only photo/video items can be grouped.
    const albumReady = (list: MediaPayload[]) =>
      list.filter((m) => m.kind === "photo" || m.kind === "video");
    if (item.addedMedia.length > 1) {
      album = albumReady(item.addedMedia);
      media = undefined;
    } else if (item.sourceGroupedMedia && item.sourceGroupedMedia.length > 0) {
      album = albumReady(item.sourceGroupedMedia);
      media = undefined;
    } else if (item.sourceGroupedId && !media) {
      album = albumReady(
        await downloadGroupedMedia(
          item.channelId,
          item.sourceMessageId,
          item.sourceGroupedId
        )
      );
      media = undefined;
    }
    if (album.length === 1) {
      media = album[0];
      album = [];
    }
    if (album.length === 0 && !media && item.addedMedia.length > 0) {
      media = item.addedMedia[0];
    }
    if (album.length === 0 && !media && item.sourceGroupedMedia?.length) {
      media = item.sourceGroupedMedia[0];
    }

    const api: any = bot.api;
    const ids: Record<string, number> = {};
    let firstId: number | undefined;

    for (const target of targets) {
      try {
        const sent =
          album.length > 0
            ? await sendMediaGroup(api, target, album, content, emojiEntities)
            : media
              ? await sendMedia(api, target, media, content, emojiEntities)
              : await api.sendMessage(
                  target,
                  content,
                  emojiEntities.length > 0 ? { entities: emojiEntities } : undefined
                );
        const sentId = sent?.message_id ?? sent?.[0]?.message_id;
        if (sentId === undefined) continue;
        const chatKey = sent?.chat?.id !== undefined ? String(sent.chat.id) : target;
        ids[chatKey] = sentId;
        if (firstId === undefined) firstId = sentId;
      } catch (error: any) {
        console.error(`[reels] publish to ${target} failed:`, error?.message || error);
      }
    }

    if (Object.keys(ids).length === 0) {
      return { ok: false, error: "Publish to targets failed." };
    }
    return { ok: true, ids, firstId };
  } catch (error: any) {
    return { ok: false, error: String(error?.message || error) };
  }
}

// Extract media/file payload from a grammY message (admin-added media + webhook source posts).
export function extractMediaPayloadFromMessage(message: any): MediaPayload | undefined {
  if (message?.photo && message.photo.length) {
    const best = message.photo[message.photo.length - 1];
    return { kind: "photo", value: best.file_id, width: best.width, height: best.height };
  }
  if (message?.video) {
    return {
      kind: "video",
      value: message.video.file_id,
      fileName: message.video.file_name,
      mimeType: message.video.mime_type,
      duration: message.video.duration,
      width: message.video.width,
      height: message.video.height,
    };
  }
  if (message?.animation) {
    return {
      kind: "animation",
      value: message.animation.file_id,
      fileName: message.animation.file_name,
      mimeType: message.animation.mime_type,
      duration: message.animation.duration,
      width: message.animation.width,
      height: message.animation.height,
    };
  }
  if (message?.audio) {
    return {
      kind: "audio",
      value: message.audio.file_id,
      fileName: message.audio.file_name,
      mimeType: message.audio.mime_type,
      duration: message.audio.duration,
    };
  }
  if (message?.voice) {
    return {
      kind: "audio",
      value: message.voice.file_id,
      duration: message.voice.duration,
      mimeType: message.voice.mime_type,
    };
  }
  if (message?.video_note) {
    return {
      kind: "video",
      value: message.video_note.file_id,
      duration: message.video_note.duration,
    };
  }
  if (message?.document) {
    return {
      kind: "document",
      value: message.document.file_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
    };
  }
  return undefined;
}