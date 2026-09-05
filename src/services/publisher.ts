import { InputFile } from "grammy";
import { getConfig, getTargetChannels, markAsProcessed } from "./storage";
import { translateToAmharic } from "./translator";
import { BotConfig, MediaPayload } from "../types";

export { MediaPayload } from "../types";

export interface TranslationResult {
  amharic: string;
  english: string;
  sourceLang: string;
}

interface SendApi {
  sendMessage(
    chatId: string,
    text: string,
    opts?: Record<string, unknown>
  ): Promise<{ message_id: number; chat?: { id: number } }>;
  [key: string]: any;
}

function buildPostContent(
  originalText: string,
  translation: TranslationResult,
  cfg: BotConfig
): string {
  const { amharic, english, sourceLang } = translation;

  if (!originalText || originalText.trim().length === 0) {
    return cfg.signature ? `—\n${cfg.signature}` : "";
  }

  let content = "";

  if (cfg.showEnglish && sourceLang !== "en") {
    content += `🇬🇧 English:\n${english}\n\n`;
  }

  if (sourceLang === "en" && cfg.showOriginal) {
    content += `📝 Original:\n${originalText}\n\n🇪🇹 Translation:\n${amharic}`;
  } else {
    content += amharic;
  }

  if (cfg.signature) {
    content += `\n\n—\n${cfg.signature}`;
  }

  return content;
}

function toBuffer(value: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("Unsupported media value");
}

function mimeExt(mime?: string): string | undefined {
  if (!mime) return undefined;
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-wav": "wav",
    "application/pdf": "pdf",
  };
  return map[mime] || mime.split("/")[1]?.split(";")[0]?.replace(/\s/g, "").slice(0, 8);
}

function defaultFileName(kind: MediaPayload["kind"], media: MediaPayload): string {
  if (media.fileName) return media.fileName;
  const ext = mimeExt(media.mimeType);
  switch (kind) {
    case "photo":
      return `photo.${ext || "jpg"}`;
    case "video":
      return `video.${ext || "mp4"}`;
    case "animation":
      return `animation.${ext || "mp4"}`;
    case "audio":
      return `audio.${ext || "ogg"}`;
    case "document":
    default:
      return ext ? `file.${ext}` : "file";
  }
}

export async function sendMedia(
  api: SendApi,
  target: string,
  media: MediaPayload,
  caption: string,
  entities?: { type: string; offset: number; length: number; custom_emoji_id: string }[]
): Promise<any> {
  const fileName = defaultFileName(media.kind, media);
  const file =
    typeof media.value === "string"
      ? media.value
      : new InputFile(toBuffer(media.value), fileName);

  const opts: Record<string, any> = { caption: caption || undefined };
  if (entities && entities.length > 0) {
    opts.caption_entities = entities;
  }
  if (media.kind === "document") {
    opts.filename = fileName;
  }
  if (media.kind === "video") {
    opts.supports_streaming = true;
  }
  if (media.mimeType && media.fileName) opts.content_type = media.mimeType;
  if (media.duration) opts.duration = media.duration;
  if (media.width) opts.width = media.width;
  if (media.height) opts.height = media.height;

  switch (media.kind) {
    case "photo":
      return api.sendPhoto(target, file, opts);
    case "video":
      return api.sendVideo(target, file, opts);
    case "animation":
      return api.sendAnimation(target, file, opts);
    case "audio":
      return api.sendAudio(target, file, opts);
    case "document":
    default:
      return api.sendDocument(target, file, opts);
  }
}

// Send a grouped media album. The caption goes on the first item only.
export async function sendMediaGroup(
  api: SendApi,
  target: string,
  mediaList: MediaPayload[],
  caption: string,
  entities?: { type: string; offset: number; length: number; custom_emoji_id: string }[]
): Promise<any> {
  if (!mediaList.length) return undefined;
  const inputs: any[] = [];
  for (let i = 0; i < mediaList.length; i++) {
    const media = mediaList[i];
    const fileName = defaultFileName(media.kind, media);
    const file =
      typeof media.value === "string"
        ? media.value
        : new InputFile(toBuffer(media.value), fileName);
    const item: Record<string, any> = {
      type: media.kind === "photo" ? "photo" : "video",
      media: file,
    };
    if (media.kind === "video") {
      item.supports_streaming = true;
      if (media.duration) item.duration = media.duration;
      if (media.width) item.width = media.width;
      if (media.height) item.height = media.height;
    }
    if (i === 0 && caption) {
      item.caption = caption;
      if (entities && entities.length > 0) {
        item.caption_entities = entities;
      }
    }
    inputs.push(item);
  }
  return api.sendMediaGroup(target, inputs);
}

export async function processAndPublish(
  api: SendApi,
  channelId: string,
  messageId: number,
  text: string,
  media?: MediaPayload | null,
  album?: MediaPayload[]
): Promise<void> {
  const cfg = await getConfig();
  const targets = await getTargetChannels();
  if (targets.length === 0) return;

  let translation: TranslationResult;
  if (!text || text.trim().length === 0) {
    translation = { amharic: text, english: text, sourceLang: "en" };
  } else {
    translation = await translateToAmharic(text);
  }
  const content = buildPostContent(text, translation, cfg);
  const targetMessageIds: Record<string, number> = {};
  let firstSentId: number | undefined;

  for (const target of targets) {
    try {
      let sent;
      if (album && album.length > 0) {
        sent = await sendMediaGroup(api, target, album, content);
      } else {
        sent = media
          ? await sendMedia(api, target, media, content)
          : await api.sendMessage(target, content);
      }
      const sentId = sent?.message_id ?? sent?.[0]?.message_id;
      if (sentId === undefined) continue;
      const chatKey = sent?.chat?.id !== undefined ? String(sent.chat.id) : target;
      targetMessageIds[chatKey] = sentId;
      if (firstSentId === undefined) firstSentId = sentId;
    } catch (error) {
      console.error(`Error sending to target ${target}:`, error);
    }
  }

  if (Object.keys(targetMessageIds).length === 0) return;

  await markAsProcessed({
    channelId,
    messageId,
    targetMessageIds,
    targetMessageId: firstSentId,
    originalText: text,
    translatedText: translation.amharic,
    englishText: translation.english,
    sourceLang: translation.sourceLang,
    processedAt: new Date().toISOString(),
  });
}