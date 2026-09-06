import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import { config } from "../config";
import { MediaPayload } from "./publisher";
import { hasInlineLinkButtons } from "./promo";

export interface MonitorMessage {
  messageId: number;
  text: string;
  date: number;
  hasMedia: boolean;
  hasInlineLink?: boolean;
  raw?: any;
  groupedId?: bigint;
  groupedMessages?: MonitorMessage[];
}

const MAX_MEDIA_BYTES = 40 * 1024 * 1024;

export function normalizeUsername(input: string): string {
  let u = (input || "").replace(/^@/, "").trim();
  u = u.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "");
  u = u.split(/[/?#]/)[0];
  return u;
}

// Normalize any user-supplied channel identifier into an https://t.me/ URL.
export function toChannelUrl(input: string): string {
  const username = normalizeUsername(input);
  if (!username) return input;
  return `https://t.me/${username}`;
}

export function createMonitorClient(): TelegramClient {
  if (!config.telegramApiId || !config.telegramApiHash || !config.telegramSession) {
    throw new Error(
      "TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION env vars are required"
    );
  }
  return new TelegramClient(
    new StringSession(config.telegramSession),
    config.telegramApiId,
    config.telegramApiHash,
    {
      connectionRetries: 2,
      autoReconnect: false,
    }
  );
}

export function classifyMedia(media: any): MediaPayload["kind"] | undefined {
  if (!media) return undefined;
  const c = media.className;
  if (c === "MessageMediaPhoto") return "photo";
  if (c === "MessageMediaVideo") return "video";
  if (c === "MessageMediaDocument") {
    const doc = media.document;
    if (!doc) return undefined;
    if (doc.sticker || doc.mimeType === "application/x-tgsticker") return undefined;
    if (doc.animated || doc.mimeType === "video/mp4" && doc.attributes?.some((a: any) => a.className === "DocumentAttributeAnimated")) {
      return "animation";
    }
    if (doc.mimeType?.startsWith("audio/") || doc.attributes?.some((a: any) => a.className === "DocumentAttributeAudio")) {
      return "audio";
    }
    return "document";
  }
  return undefined;
}

export async function downloadMedia(
  client: TelegramClient,
  msg: any
): Promise<MediaPayload | undefined> {
  if (!msg?.media || !msg.media.className || msg.media.className === "MessageMediaEmpty") {
    return undefined;
  }
  const kind = classifyMedia(msg.media);
  if (!kind) return undefined;

  try {
    const data: any = await client.downloadMedia(msg, {});
    if (!data) return undefined;
    const size = data.byteLength ?? data.length ?? 0;
    if (size > MAX_MEDIA_BYTES) {
      console.warn(`[mtproto] skipping media larger than 20MB (${size} bytes)`);
      return undefined;
    }

    const payload: MediaPayload = { kind, value: data };

    if (msg.media.document) {
      const doc = msg.media.document;
      payload.fileName = doc.fileName;
      payload.mimeType = doc.mimeType;
      for (const attr of doc.attributes || []) {
        if (attr.className === "DocumentAttributeVideo") {
          payload.duration = attr.duration;
          payload.width = attr.w;
          payload.height = attr.h;
        } else if (attr.className === "DocumentAttributeAudio") {
          payload.duration = attr.duration;
        }
      }
    } else if (msg.media.photo) {
      const sizes = msg.media.photo.sizes || [];
      let last: any = null;
      for (const s of sizes) {
        if (s.w && s.h) last = s;
      }
      if (last) {
        payload.width = last.w;
        payload.height = last.h;
      }
    }

    return payload;
  } catch (error: any) {
    console.error("[mtproto] downloadMedia failed:", error?.message || error);
    return undefined;
  }
}

function toMessage(m: any): MonitorMessage | undefined {
  if (!m || m.className !== "Message") return undefined;
  const hasMedia =
    Boolean(m.media && m.media.className !== "MessageMediaEmpty");
  // Include media posts even when they have no caption text
  if (!m.message && !hasMedia) return undefined;
  const hasInlineLink = hasInlineLinkButtons(m);
  return {
    messageId: m.id,
    text: String(m.message || "").trim(),
    date: m.date,
    hasMedia,
    hasInlineLink,
    raw: hasMedia ? m : undefined,
    groupedId: m.groupedId,
  };
}

export async function fetchRawMessage(
  client: TelegramClient,
  username: string,
  messageId: number
): Promise<any | undefined> {
  const cleanName = normalizeUsername(username);
  if (!cleanName) return undefined;

  let peer;
  try {
    peer = await client.getInputEntity(cleanName);
  } catch {
    return undefined;
  }

  try {
    // GetHistory(offsetId) returns messages with id <= offsetId, newest first,
    // so the exact message is the first entry. (messages.getMessages without a
    // peer fails for channels, which broke the media preview pipeline.)
    const res: any = await client.invoke(
      new Api.messages.GetHistory({
        peer,
        offsetId: messageId + 1,
        limit: 1,
      })
    );
    const msg = res?.messages?.find(
      (m: any) => m.id === messageId && m.className === "Message"
    );
    return msg;
  } catch {
    return undefined;
  }
}

// Fetch all messages in a grouped media album by groupedId
export async function fetchGroupedMedia(
  client: TelegramClient,
  username: string,
  baseMessageId: number,
  groupedId: bigint | string
): Promise<any[]> {
  const cleanName = normalizeUsername(username);
  if (!cleanName) return [];

  let peer;
  try {
    peer = await client.getInputEntity(cleanName);
  } catch {
    return [];
  }

  try {
    // Fetch messages around the base message to find all in the same group
    const res: any = await client.invoke(
      new Api.messages.GetHistory({
        peer,
        limit: 50,
        addOffset: -25,
        offsetId: baseMessageId,
      })
    );
    const messages = res?.messages || [];
    return messages.filter(
      (m: any) =>
        m.className === "Message" &&
        m.groupedId !== undefined &&
        String(m.groupedId) === String(groupedId)
    );
  } catch {
    return [];
  }
}

export async function fetchMessageLink(
  client: TelegramClient,
  username: string,
  messageId: number
): Promise<string | undefined> {
  const cleanName = normalizeUsername(username);
  if (!cleanName) return undefined;

  let channel;
  try {
    channel = await client.getInputEntity(cleanName);
  } catch {
    return undefined;
  }

  try {
    const res: any = await client.invoke(
      new Api.channels.ExportMessageLink({
        channel,
        id: messageId,
      })
    );
    return res?.link || undefined;
  } catch {
    return undefined;
  }
}

export interface SourceMeta {
  channelTitle?: string;
  channelUsername?: string;
  sourceLink?: string;
}

// Resolve channel identity + official post link from the message's own metadata
// (the peer it was posted in), not from any stored channel string.
export async function resolveChannelMeta(
  client: TelegramClient,
  rawMsg: any,
  messageId: number
): Promise<SourceMeta> {
  const out: SourceMeta = {};
  const peer = rawMsg?.peerId;
  if (!peer) return out;

  let entity: any;
  try {
    entity = await client.getEntity(peer);
  } catch {
    return out;
  }

  out.channelTitle = entity?.title || entity?.username;
  out.channelUsername = entity?.username;

  if (entity) {
    try {
      const res: any = await client.invoke(
        new Api.channels.ExportMessageLink({
          channel: entity,
          id: messageId,
        })
      );
      out.sourceLink = res?.link || undefined;
    } catch {
      // private/restricted channel: no public link
    }
  }

  return out;
}

export async function fetchRecentMessages(
  client: TelegramClient,
  username: string,
  limit = 10
): Promise<MonitorMessage[]> {
  const cleanName = normalizeUsername(username);
  if (!cleanName) return [];

  let peer;
  try {
    peer = await client.getInputEntity(cleanName);
  } catch {
    return [];
  }

  try {
    const result = (await client.invoke(
      new Api.messages.GetHistory({
        peer,
        limit,
      })
    )) as any;

    const messages = result?.messages || [];
    const out: MonitorMessage[] = [];
    for (const m of messages) {
      const item = toMessage(m);
      if (item) out.push(item);
    }
    return out;
  } catch (error: any) {
    const err = error?.errorMessage || "";
    // Private/joined-required: attempt a silent join then retry once
    if (
      err.includes("CHANNEL_PRIVATE") ||
      err.includes("USER_NOT_PARTICIPANT") ||
      err.includes("CHAT_WRITE_FORBIDDEN")
    ) {
      try {
        await client.invoke(
          new Api.channels.JoinChannel({
            channel: peer,
          })
        );
        const result = (await client.invoke(
          new Api.messages.GetHistory({
            peer,
            limit,
          })
        )) as any;
        const messages = result?.messages || [];
        const out: MonitorMessage[] = [];
        for (const m of messages) {
          const item = toMessage(m);
          if (item) out.push(item);
        }
        return out;
      } catch {
        return [];
      }
    }
    return [];
  }
}