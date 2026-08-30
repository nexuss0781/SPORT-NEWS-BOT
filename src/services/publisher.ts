import { getConfig, getTargetChannels, markAsProcessed } from "./storage";
import { translateToAmharic } from "./translator";
import { BotConfig } from "../types";

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
}

function buildPostContent(
  originalText: string,
  translation: TranslationResult,
  cfg: BotConfig
): string {
  const { amharic, english, sourceLang } = translation;
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

export async function processAndPublish(
  api: SendApi,
  channelId: string,
  messageId: number,
  text: string
): Promise<void> {
  const cfg = getConfig();
  const targets = getTargetChannels();
  if (targets.length === 0) return;

  const translation = await translateToAmharic(text);
  const content = buildPostContent(text, translation, cfg);
  const targetMessageIds: Record<string, number> = {};
  let firstSentId: number | undefined;

  for (const target of targets) {
    try {
      const sent = await api.sendMessage(target, content);
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

  markAsProcessed({
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