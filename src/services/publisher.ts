import { InputFile } from "grammy";
import { getConfig, getTargetChannels, markAsProcessed } from "./storage";
import { translateToAmharic } from "./translator";
import { BotConfig } from "../types";

export interface TranslationResult {
  amharic: string;
  english: string;
  sourceLang: string;
}

export interface MediaPayload {
  kind: "photo" | "video" | "animation" | "document" | "audio";
  value: string | Buffer | Uint8Array | ArrayBuffer;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  width?: number;
  height?: number;
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
    content += `📢 ${amharic}`;
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

async function sendMedia(
  api: SendApi,
  target: string,
  media: MediaPayload,
  caption: string
): Promise<any> {
  const file =
    typeof media.value === "string"
      ? media.value
      : new InputFile(toBuffer(media.value), media.fileName || "media.bin");

  const opts: Record<string, any> = { caption: caption || undefined };
  if (media.fileName && (media.kind === "document" || media.kind === "animation")) {
    opts.filename = media.fileName;
  }
  if (media.mimeType) opts.content_type = media.mimeType;
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

export async function processAndPublish(
  api: SendApi,
  channelId: string,
  messageId: number,
  text: string,
  media?: MediaPayload | null
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
      const sent = media
        ? await sendMedia(api, target, media, content)
        : await api.sendMessage(target, content);
      const sentId = sent?.message_id;
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